import express from 'express'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { z } from 'zod'
import { DiffSide, ReviewEvent } from '../shared/types'
import { preferencesSchema } from '../shared/preferences'
import { fetchPull, getInbox, listRepositories, submitReview } from './github'
import { ReviewerStore, ReviewNotFoundError } from './store'
import { createRevisionChecker } from './updates'
import { getStackForPull } from './stacks'
import { fetchPullStatus, fetchInboxStatuses } from './pullStatus'
import { organizePull } from './organize'
import { getAppStatus } from './toolStatus'
import { fetchDiscussions, replyToThread } from './discussions'
import { createSourceNavigator } from './navigation'
import { createFileContentLoader, createSourceProjectLoader } from './fileContent'
import { configureSourceAssetsDirectory } from './treeSymbols'
import { LanguageServers } from './languageServers'
import { LanguageServerNavigation } from './lspNavigation'

export interface ReviewerServerOptions {
  dataDirectory: string
  staticDirectory: string
  sourceAssetsDirectory?: string
  port?: number
  allowedOrigins?: string[]
}

export async function startReviewerServer(
  options: ReviewerServerOptions,
): Promise<{ url: string; close: () => Promise<void> }> {
  configureSourceAssetsDirectory(options.sourceAssetsDirectory)
  const store = new ReviewerStore({ dataDirectory: options.dataDirectory })
  const getPull = async (id: string) => store.getPull(id)
  const savePull = async (pull: Parameters<ReviewerStore['savePull']>[0]) => store.savePull(pull)
  const checkRevision = createRevisionChecker()
  const loadFileContent = createFileContentLoader()
  const sourceProject = createSourceProjectLoader()
  const languageServers = new LanguageServers(options.dataDirectory)
  let languageNavigation = new LanguageServerNavigation(sourceProject, languageServers)
  let navigateSource = createSourceNavigator(sourceProject, languageNavigation)
  const app = express()
  let ownOrigin = ''
  app.disable('x-powered-by')
  app.use((_request, response, next) => {
    const developmentSockets = options.allowedOrigins?.length
      ? ' ws://localhost:4310 ws://127.0.0.1:4310'
      : ''
    response.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'${developmentSockets}; img-src 'self' data: https://github.com https://*.githubusercontent.com; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'`,
    )
    next()
  })
  app.use((request, response, next) => {
    if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(request.hostname)) {
      response.status(403).json({ error: 'This app accepts local connections only.' })
      return
    }
    const origin = request.headers.origin
    if (origin && origin !== ownOrigin && !options.allowedOrigins?.includes(origin)) {
      response.status(403).json({ error: 'This request did not originate from the local app.' })
      return
    }
    next()
  })
  app.use(express.json({ limit: '1mb' }))

  const commentSchema = z.object({
    id: z.string().max(100),
    body: z.string().min(1).max(10000),
    path: z.string().max(2000),
    line: z.number().int().positive(),
    side: z.enum(DiffSide),
    code: z.string().max(20000).optional(),
    headSha: z.string().max(100),
  })
  const draftSchema = z.object({
    comments: z.array(commentSchema).max(300),
    viewedFileIds: z.array(z.string().max(100)).max(10000),
    viewedHunkIds: z.array(z.string().max(100)).max(50000).optional(),
    summary: z.string().max(30000),
  })
  type Job = {
    status: 'running' | 'complete' | 'failed'
    error?: string
    controller: AbortController
    pullId: string
  }
  const jobs = new Map<string, Job>()

  app.get('/api/preferences', (_request, response) => response.json(store.getPreferences()))
  app.get('/api/language-servers', async (_request, response) => response.json(await languageServers.statuses()))
  app.put('/api/language-servers', async (request, response) => {
    await languageServers.save(request.body)
    await languageNavigation.close()
    languageNavigation = new LanguageServerNavigation(sourceProject, languageServers)
    navigateSource = createSourceNavigator(sourceProject, languageNavigation)
    response.json(await languageServers.statuses())
  })
  app.put('/api/preferences', (request, response) => {
    const preferences = preferencesSchema.parse(request.body)
    response.json(store.savePreferences(preferences))
  })
  app.get('/api/pulls/:id/draft', (request, response) =>
    response.json(store.getDraft(request.params.id)),
  )
  app.put('/api/pulls/:id/draft', (request, response) => {
    const writerId = request.get('X-Review-Writer')
    const sequence = request.get('X-Review-Sequence')
    const write =
      writerId == null && sequence == null
        ? undefined
        : z
            .object({
              writerId: z.string().min(1).max(100),
              sequence: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
            })
            .parse({ writerId, sequence })
    response.json(store.saveDraft(request.params.id, draftSchema.parse(request.body), write))
  })
  app.get('/api/stack', async (request, response) => {
    const url = z.string().min(1).max(2000).parse(request.query.url)
    response.json(await getStackForPull(url, { refresh: request.query.refresh === '1' }))
  })
  app.get('/api/pull-status', async (request, response) => {
    const url = z.string().min(1).max(2000).parse(request.query.url)
    response.json(await fetchPullStatus(url, true))
  })
  app.get('/api/pulls/:id/status', async (request, response) => {
    response.json(await fetchPullStatus(store.getPull(request.params.id).url, true))
  })
  app.get('/api/pulls/:id/stack', async (request, response) => {
    response.json(await getStackForPull(store.getPull(request.params.id).url))
  })
  app.get('/api/pulls/:id/revision', async (request, response) => {
    response.json(await checkRevision(store.getPull(request.params.id)))
  })
  app.get('/api/pulls/:id/files/:fileId/content', async (request, response) => {
    const pull = store.getPull(request.params.id)
    const content = await loadFileContent(
      pull,
      z.string().min(1).max(100).parse(request.params.fileId),
    )
    if (!pull.mergeBaseSha && content.old) {
      const latest = store.getPull(pull.id)
      latest.mergeBaseSha = content.old.sha
      store.savePull(latest)
    }
    response.json(content)
  })
  app.get('/api/pulls/:id/source-tree', async (request, response) => {
    const pull = store.getPull(request.params.id)
    response.json(await sourceProject.tree(pull, z.enum(DiffSide).parse(request.query.side)))
  })
  app.post('/api/pulls/:id/navigation', async (request, response) => {
    const selection = z
      .object({
        side: z.enum(DiffSide),
        path: z.string().min(1).max(2000),
        line: z.number().int().positive().max(1_000_000),
        column: z.number().int().positive().max(1_000_000),
        kind: z.enum(['definition', 'references']),
      })
      .strict()
      .parse(request.body)
    response.json(await navigateSource(store.getPull(request.params.id), selection))
  })
  app.get('/api/pulls/:id/source-file', async (request, response) => {
    const pull = store.getPull(request.params.id)
    response.json(
      await sourceProject.file(
        pull,
        z.enum(DiffSide).parse(request.query.side),
        z.string().min(1).max(2000).parse(request.query.path),
      ),
    )
  })
  app.get('/api/status', async (_request, response) => {
    response.json(await getAppStatus())
  })
  app.get('/api/repositories', async (_request, response) => {
    response.json(await listRepositories())
  })
  app.get('/api/inbox-status', async (request, response) => {
    const repository = z
      .string()
      .max(300)
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .parse(request.query.repository)
    const filter = z.enum(['all', 'mine']).default('all').parse(request.query.filter)
    try {
      const statuses = await fetchInboxStatuses(repository, request.query.refresh === '1', filter)
      response.json({
        statuses: [...statuses].map(([number, status]) => ({ number, status })),
        warnings: [],
      })
    } catch {
      response.json({
        statuses: [],
        warnings: ['GitHub CI and review metadata is unavailable. Refresh the inbox to retry.'],
      })
    }
  })
  app.get('/api/inbox', async (request, response) => {
    response.json(await getInbox(z.string().parse(request.query.repository)))
  })
  app.post('/api/pulls', async (request, response) => {
    const { url } = z.object({ url: z.string().max(2000) }).parse(request.body)
    let pr = await fetchPull(url)
    try {
      const cached = await getPull(pr.id)
      if (cached.groupingSource !== 'files')
        pr = { ...pr, groups: cached.groups, groupingSource: cached.groupingSource }
    } catch {
      /* A new revision starts with file ordering. */
    }
    await savePull(pr)
    response.json(pr)
  })
  app.get('/api/pulls/:id', async (request, response) => {
    response.json(await getPull(request.params.id))
  })
  app.get('/api/pulls/:id/threads', async (request, response) => {
    response.json(await fetchDiscussions(await getPull(request.params.id)))
  })
  app.post('/api/pulls/:id/threads/:threadId/replies', async (request, response) => {
    const { body } = z.object({ body: z.string().trim().min(1).max(10000) }).parse(request.body)
    response.json(
      await replyToThread({
        pr: await getPull(request.params.id),
        threadId: request.params.threadId,
        body,
      }),
    )
  })
  app.post('/api/pulls/:id/organize', async (request, response) => {
    const { force } = z
      .object({ force: z.boolean().default(false) })
      .strict()
      .parse(request.body)
    const organization = store.getPreferences().organization
    if (!organization) throw new Error('Choose your coding provider and model in Settings first.')
    const pr = await getPull(request.params.id)
    const running = [...jobs].find(([, job]) => job.pullId === pr.id && job.status === 'running')
    if (running) {
      response.status(202).json({ id: running[0] })
      return
    }
    if (!force && pr.groupingSource !== 'files') {
      response.json({ complete: true })
      return
    }
    const id = randomUUID()
    const job: Job = { status: 'running', controller: new AbortController(), pullId: pr.id }
    jobs.set(id, job)
    response.status(202).json({ id })
    void organizePull(pr, organization, job.controller.signal)
      .then(async (groups) => {
        const latest = await getPull(pr.id)
        await savePull({ ...latest, groups, groupingSource: organization.provider })
        job.status = 'complete'
      })
      .catch((error: unknown) => {
        job.status = 'failed'
        job.error = error instanceof Error ? error.message : 'Organization failed.'
      })
    // Finished jobs remain briefly available for reconnecting browser tabs.
    setTimeout(
      () => {
        if (job.status !== 'running') jobs.delete(id)
      },
      60 * 60 * 1000,
    ).unref()
  })
  app.get('/api/jobs/:id', (request, response) => {
    const job = jobs.get(request.params.id)
    if (!job) {
      response.status(404).json({ error: 'This organization job is no longer available.' })
      return
    }
    response.json({ status: job.status, error: job.error, pullId: job.pullId })
  })
  app.delete('/api/jobs/:id', (request, response) => {
    jobs.get(request.params.id)?.controller.abort()
    response.json({ ok: true })
  })
  app.post('/api/pulls/:id/reviews', async (request, response) => {
    const { draft, event } = z
      .object({ draft: draftSchema, event: z.enum(ReviewEvent) })
      .parse(request.body)
    const pr = await getPull(request.params.id)
    response.json(await submitReview(pr, draft, event))
  })

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Unknown API route.' })
  })
  app.use(express.static(resolve(options.staticDirectory)))
  app.get('/{*rest}', (_request, response) => {
    response.sendFile(resolve(options.staticDirectory, 'index.html'))
  })
  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const message =
        error instanceof z.ZodError
          ? 'The request contained invalid data.'
          : error instanceof Error
            ? error.message
            : 'Something went wrong.'
      response.status(error instanceof ReviewNotFoundError ? 404 : 400).json({ error: message })
    },
  )

  const server = app.listen(options.port ?? 4311, '127.0.0.1')
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  }).catch((error: unknown) => {
    store.close()
    throw error
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Could not start the local review server.')
  ownOrigin = `http://127.0.0.1:${address.port}`
  let closing: Promise<void> | undefined
  return {
    url: ownOrigin,
    close: () => {
      closing ??= new Promise<void>((resolve, reject) => {
        for (const job of jobs.values()) job.controller.abort()
        server.close((error) => {
          void languageNavigation.close().then(() => {
            store.close()
            if (error) reject(error)
            else resolve()
          }, reject)
        })
        server.closeIdleConnections()
      })
      return closing
    },
  }
}
