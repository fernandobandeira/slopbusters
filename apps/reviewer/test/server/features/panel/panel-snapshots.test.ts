import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewNotFoundError } from '../../../../server/adapters/store'
import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../../../../server/adapters/t3Engine/engineTurns'
import { UserError } from '../../../../server/errors'
import { localSnapshotLoader } from '../../../../server/features/panel/localRound'
import { fetchPull } from '../../../../server/features/pulls/github'
import { createStackService } from '../../../../server/features/pulls/stacks'
import { createServices, type Services } from '../../../../server/services'
import type { LocalRound } from '../../../../shared/domain/panelFix'
import { Provider } from '../../../../shared/domain/types'
import { fixtureGroupingReply } from '../../../fixtures/grouping'
import { fixturePanelAdvice } from '../../../fixtures/panel'
import { primary, reply, repository } from '../../../fixtures/panelJobs'
import { fixturePull } from '../../../fixtures/pull'
import { recordingTurns } from '../../../fixtures/turns'

vi.mock('../../../../server/features/pulls/github', async (original) => ({
  ...(await original<typeof import('../../../../server/features/pulls/github')>()),
  fetchPull: vi.fn(),
  createPullService: () => ({ fetchPull, fetchPullRevision: vi.fn() }),
}))
vi.mock('../../../../server/features/pulls/stacks', () => ({ createStackService: vi.fn() }))
vi.mock('../../../../server/features/panel/localRound', async (original) => ({
  ...(await original<typeof import('../../../../server/features/panel/localRound')>()),
  localSnapshotLoader: vi.fn(),
}))
vi.mock('../../../../server/adapters/reviewWorkspaces', () => ({
  ReviewWorkspaces: class {
    removeAbandoned() {
      return Promise.resolve()
    }
    unused() {
      return Promise.resolve([])
    }
    acquire() {
      return Promise.reject(new UserError('No source in fixture.'))
    }
    close() {
      return Promise.resolve()
    }
  },
}))

const pull = fixturePull()
const sibling = { ...pull, number: 129, url: pull.url.replace(/128$/, '129'), id: 'sibling' }
const getStackMetadata = vi.fn<ReturnType<typeof createStackService>['getStackMetadata']>()
const offline = () => Promise.reject(new UserError('No GitHub data in fixture.'))
const groupingReply = fixtureGroupingReply(pull)
let data: string
let services: Services | undefined

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'panel-snapshots-'))
  vi.mocked(fetchPull).mockImplementation((url) =>
    Promise.resolve(url === sibling.url ? sibling : pull),
  )
  getStackMetadata.mockResolvedValue({ stack: null, warnings: [] })
  vi.mocked(createStackService).mockReturnValue({
    getStackMetadata,
    getStackForPull: vi.fn(),
    listNativeStacks: vi.fn(),
  })
  vi.mocked(localSnapshotLoader).mockReturnValue(vi.fn())
})
afterEach(async () => {
  await services?.close()
  services = undefined
  rmSync(data, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

function setup(turns: StructuredTurns) {
  services = createServices({
    dataDirectory: data,
    staticDirectory: data,
    skillRoots: { claude: join(data, 'claude'), codex: join(data, 'codex') },
    bobSkillDirectory: fileURLToPath(new URL('../../../../../../skills/unclebob', import.meta.url)),
    structuredTurns: turns,
    github: { rest: offline, graphql: offline, paginate: offline },
  })
  services.store.savePreferences({ organization: primary })
  return services
}

async function complete(
  app: Services,
  { local, url = pull.url }: { local?: LocalRound; url?: string } = {},
) {
  const { id } = await app.panelJobs.start(repository, [url], ['unclebob'], { local })
  await vi.waitFor(() => {
    expect(app.panelJobs.get(id).status).toBe('complete')
  })
  await setImmediate()
  return app.panelJobs.get(id)
}

function groupingSessions(app: Services) {
  return app.agentSessions.store.list(repository).filter(({ kind }) => kind === 'grouping')
}

function panelReply(request: StructuredTurnRequest<unknown>) {
  if (request.purpose?.startsWith('Panel consistency')) return { reversals: [], conflicts: [] }
  return reply(request)
}

describe('snapshots from completed panels', () => {
  it('saves the reviewed PR before grouping it, keeps groups on a second round, and skips siblings', async () => {
    getStackMetadata.mockResolvedValue({
      stack: {
        id: 'stack',
        source: 'github',
        baseBranch: 'main',
        position: 1,
        size: 2,
        items: [pull, sibling].map((item) => ({
          ...item,
          repository,
          state: 'open',
          isDraft: false,
        })),
        warnings: [],
      },
      warnings: [],
    })
    const group = vi.fn(() => {
      expect(app.store.getPull(pull.id).groupingSource).toBe('files')
      expect(app.panelJobs.latest(repository, pull.url)?.status).toBe('complete')
      return groupingReply
    })
    const { turns } = recordingTurns((request) =>
      request.purpose?.startsWith('Organize') ? group() : panelReply(request),
    )
    const app = setup(turns)

    await complete(app)
    await vi.waitFor(() => {
      expect(app.store.getPull(pull.id).groupingSource).toBe(Provider.claude)
    })
    await complete(app)

    expect(group).toHaveBeenCalledTimes(1)
    expect(app.store.getPull(pull.id).groups).toMatchObject(groupingReply.rest)
    expect(fetchPull).toHaveBeenCalledWith(sibling.url)
    expect(() => app.store.getPull(sibling.id)).toThrow(ReviewNotFoundError)
  })

  it('keeps a local snapshot only in the panel result', async () => {
    const local = {
      url: pull.url,
      worktreePath: data,
      branch: 'fixes',
      reviewedSha: pull.headSha,
      sha: 'local-head',
      mergeBaseSha: pull.baseSha,
      from: 'earlier-panel',
    }
    const snapshot = {
      ...pull,
      id: 'local',
      headSha: local.sha,
      mergeBaseSha: local.mergeBaseSha,
      groupingSource: 'files' as const,
    }
    vi.mocked(localSnapshotLoader).mockReturnValue(() => Promise.resolve(snapshot))
    const app = setup(recordingTurns(reply).turns)

    const session = await complete(app, { local })

    expect(session.results[0]?.pull.id).toBe(snapshot.id)
    expect(() => app.store.getPull(snapshot.id)).toThrow(ReviewNotFoundError)
    expect(() => app.store.getPull(pull.id)).toThrow(ReviewNotFoundError)
    expect(groupingSessions(app)).toEqual([])
  })
})

describe('background grouping jobs', () => {
  it('records a grouping failure without changing the successful panel result', async () => {
    const failure = new Error('Grouping model failed in fixture.')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { turns } = recordingTurns((request) => {
      if (request.purpose?.startsWith('Organize')) throw failure
      return panelReply(request)
    })
    const app = setup(turns)

    const session = await complete(app)
    await vi.waitFor(() => {
      expect(groupingSessions(app)).toMatchObject([{ status: 'failed' }])
    })

    expect(app.panelJobs.get(session.id)).toEqual(session)
    expect(session.error).toBeUndefined()
    expect(session.results).toHaveLength(1)
    expect(app.store.getPull(pull.id).groupingSource).toBe('files')
    expect(errors).toHaveBeenCalledWith(expect.any(String), failure)
  })

  it('keeps queued grouping visible and cancellable while another grouping turn runs', async () => {
    let release!: () => void
    const finish = new Promise<void>((resolve) => {
      release = resolve
    })
    const group = vi.fn()
    const app = setup({
      run: async <T>(request: StructuredTurnRequest<T>) => {
        if (!request.purpose?.startsWith('Organize'))
          return request.schema.parse(fixturePanelAdvice([]))
        group(request.purpose)
        await Promise.race([finish, cancelled(request.signal)])
        return request.schema.parse(groupingReply)
      },
    })

    await complete(app)
    await complete(app, { url: sibling.url })
    const queued = groupingSessions(app).find(({ urls }) => urls.includes(sibling.url))
    expect(queued).toMatchObject({ status: 'running', runs: [] })
    expect(group).toHaveBeenCalledTimes(1)
    if (!queued) throw new Error('Missing queued grouping session.')

    app.organizationJobs.cancel(queued.id)
    release()

    await vi.waitFor(() => {
      expect(app.agentSessions.store.getSession(queued.id).status).toBe('cancelled')
      expect(app.store.getPull(pull.id).groupingSource).toBe(Provider.claude)
    })
    expect(group).toHaveBeenCalledTimes(1)
    expect(app.store.getPull(sibling.id).groupingSource).toBe('files')
  })
})

describe('grouping asked for from the review screen', () => {
  it('starts at once while a panel’s background grouping is still running', async () => {
    let release!: () => void
    const finish = new Promise<void>((resolve) => {
      release = resolve
    })
    const group = vi.fn()
    const app = setup({
      run: async <T>(request: StructuredTurnRequest<T>) => {
        if (!request.purpose?.startsWith('Organize'))
          return request.schema.parse(fixturePanelAdvice([]))
        group(request.purpose)
        await finish
        return request.schema.parse(groupingReply)
      },
    })

    await complete(app)
    await vi.waitFor(() => {
      expect(group).toHaveBeenCalledTimes(1)
    })
    app.store.savePull(sibling)
    app.organizationJobs.start(sibling.id, false)

    await vi.waitFor(() => {
      expect(group).toHaveBeenCalledTimes(2)
    })
    release()
    await vi.waitFor(() => {
      expect(app.store.getPull(sibling.id).groupingSource).toBe(Provider.claude)
    })
  })
})

function cancelled(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.throwIfAborted()
    signal.addEventListener(
      'abort',
      () => {
        reject(new Error('Cancelled'))
      },
      { once: true },
    )
  })
}
