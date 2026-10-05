import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { runCommand } from '../server/adapters/process'
import { LocalSourceRepository } from '../server/adapters/sourceRepository'
import { ReviewWorkspaces } from '../server/adapters/reviewWorkspaces'
import { createSourceNavigator } from '../server/features/navigation/navigation'
import { createSourceProjectLoader } from '../server/features/navigation/fileContent'
import { WorkspaceTypeScriptNavigation } from '../server/adapters/workspaceNavigation'
import { startRepositoryTools } from '../server/adapters/repositoryTools'
import { DiffSide } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/adapters/store'
import { createSourceWorkspace } from '../server/adapters/sourceWorkspace'
import { startLanguageServer } from '../server/adapters/lspClient'
import { fileURLToPath } from 'node:url'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture(extra: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'review-checkout-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const origin = join(directory, 'origin')
  await mkdir(origin)
  const git = async (...args: string[]) =>
    (
      await runCommand({
        command: 'git',
        cwd: origin,
        args: ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args],
      })
    ).trim()
  await git('init', '--template=', '--initial-branch=main')
  const files = {
    'tsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@domain/*":["src/*"]}}}',
    'src/use.ts':
      "import { Purpose } from '@domain/types'\nexport const selected = Purpose.deposit\n",
    'src/types.ts': "export enum Purpose { deposit = 'deposit', payment = 'payment' }\n",
    'src/unrelated.ts': 'export const Purpose = 42\n',
    'docs/context.md': 'The surrounding repository matters to a review.\n',
    ...extra,
  }
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(origin, path, '..'), { recursive: true })
    await writeFile(join(origin, path), text)
  }
  await git('add', '.')
  await git('commit', '-m', 'First revision')
  const base = await git('rev-parse', 'HEAD')
  await writeFile(
    join(origin, 'src/types.ts'),
    "export enum Purpose { deposit = 'deposit', payment = 'payment', loan = 'loan' }\n",
  )
  await git('commit', '-am', 'Second revision')
  const head = await git('rev-parse', 'HEAD')
  // A user's current branch and uncommitted edits must never become review source.
  await git('switch', '-c', 'unrelated-work')
  await writeFile(join(origin, 'src/types.ts'), 'export const Purpose = "local-only"\n')
  const pull = { ...fixturePull(), headSha: head, baseSha: base, mergeBaseSha: base }
  const data = join(directory, 'data')
  const repository = new LocalSourceRepository(data, () => pathToFileURL(origin).href)
  cleanup.push(() => repository.close())
  const project = createSourceProjectLoader(repository)
  const workspaces = new ReviewWorkspaces(data, repository)
  cleanup.push(() => workspaces.close())
  return { directory, origin, git, pull, data, repository, project, workspaces }
}

describe('independent local review checkouts', () => {
  it('prepares, navigates, lists, and removes an exact checkout through the application API', async () => {
    const { pull, data, origin } = await fixture()
    const store = new ReviewerStore({ dataDirectory: data })
    store.savePull(pull)
    store.close()
    const app = await startReviewerServer({
      dataDirectory: data,
      staticDirectory: data,
      port: 0,
      sourceRemoteUrl: () => pathToFileURL(origin).href,
    })
    cleanup.push(() => app.close())
    const request = (path: string, method: string, body: unknown) =>
      fetch(`${app.url}/api${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    const prepared = await request(`/pulls/${pull.id}/workspace`, 'POST', { side: DiffSide.right })
    expect(prepared.status).toBe(200)
    expect(await prepared.json()).toMatchObject({ sha: pull.headSha, status: 'ready' })
    const navigation = await request(`/pulls/${pull.id}/navigation`, 'POST', {
      side: DiffSide.right,
      path: 'src/use.ts',
      line: 2,
      column: 25,
      kind: 'definition',
    })
    expect(await navigation.json()).toMatchObject({
      source: { sha: pull.headSha, kind: 'local' },
      targets: [{ path: 'src/types.ts' }],
    })
    expect(await (await fetch(`${app.url}/api/workspaces`)).json()).toMatchObject([
      { owner: pull.owner, repo: pull.repo, sha: pull.headSha },
    ])
    const removed = await request('/workspaces', 'DELETE', {
      owner: pull.owner,
      repo: pull.repo,
      sha: pull.headSha,
    })
    expect(removed.status).toBe(200)
    expect(await (await fetch(`${app.url}/api/workspaces`)).json()).toEqual([])
    expect(
      (
        await request('/workspaces', 'DELETE', {
          owner: '../outside',
          repo: pull.repo,
          sha: pull.headSha,
        })
      ).status,
    ).toBe(400)
  }, 20_000)
  it('coalesces preparation, pins both revisions, and survives removal of its source cache', async () => {
    const { pull, data, origin, git, workspaces } = await fixture()
    const [first, second, old] = await Promise.all([
      workspaces.acquire(pull, pull.headSha),
      workspaces.acquire(pull, pull.headSha),
      workspaces.acquire(pull, pull.mergeBaseSha),
    ])
    expect(first.workspace.directory).toBe(second.workspace.directory)
    expect(old.workspace.directory).not.toBe(first.workspace.directory)
    expect(await readFile(join(first.workspace.directory, 'src/types.ts'), 'utf8')).toContain(
      'loan',
    )
    expect(await readFile(join(old.workspace.directory, 'src/types.ts'), 'utf8')).not.toContain(
      'loan',
    )
    expect(await git('branch', '--show-current')).toBe('unrelated-work')
    expect(await readFile(join(origin, 'src/types.ts'), 'utf8')).toContain('local-only')
    await expect(workspaces.remove(pull, pull.headSha)).rejects.toThrow('in use')
    await rm(join(data, 'source-repositories'), { recursive: true, force: true })
    expect(
      (
        await runCommand({
          command: 'git',
          args: ['-C', first.workspace.directory, 'show', 'HEAD:src/types.ts'],
        })
      ).trim(),
    ).toContain('loan')
    await expect(
      readFile(join(first.workspace.directory, '.git', 'objects', 'info', 'alternates'), 'utf8'),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    first.release()
    second.release()
    old.release()
  })

  it('reuses committed source offline after restart without the cache or original clone', async () => {
    const { pull, data, origin, repository, workspaces } = await fixture()
    const lease = await workspaces.acquire(pull, pull.headSha)
    lease.release()
    await workspaces.close()
    await repository.close()
    await rm(join(data, 'source-repositories'), { recursive: true, force: true })
    await rm(origin, { recursive: true, force: true })
    const offline = new LocalSourceRepository(data, () => pathToFileURL(origin).href)
    cleanup.push(() => offline.close())
    const restarted = new ReviewWorkspaces(data, offline)
    cleanup.push(() => restarted.close())
    const reopened = await restarted.acquire(pull, pull.headSha)
    expect(reopened.workspace.directory).toBe(lease.workspace.directory)
    expect(
      (await offline.file(pull.owner, pull.repo, pull.headSha, 'src/types.ts')).text,
    ).toContain('loan')
    reopened.release()
    await restarted.remove(pull, pull.headSha)
    await expect(offline.tree(pull.owner, pull.repo, pull.headSha)).rejects.toThrow()
  })

  it('reopens clean checkouts after restart and preserves unexpected edits on retry and removal', async () => {
    const { pull, data, repository, workspaces } = await fixture()
    const lease = await workspaces.acquire(pull, pull.headSha)
    lease.release()
    await workspaces.close()
    const restarted = new ReviewWorkspaces(data, repository)
    cleanup.push(() => restarted.close())
    const reopened = await restarted.acquire(pull, pull.headSha)
    expect(reopened.workspace.directory).toBe(lease.workspace.directory)
    reopened.release()
    await writeFile(join(lease.workspace.directory, 'notes.md'), 'Keep this investigation\n')
    await expect(restarted.acquire(pull, pull.headSha)).rejects.toThrow('changes')
    await expect(restarted.remove(pull, pull.headSha)).rejects.toThrow('changes')
    expect(await readFile(join(lease.workspace.directory, 'notes.md'), 'utf8')).toContain('Keep')
    expect(restarted.status(pull, pull.headSha)).toMatchObject({ status: 'failed' })
    await rm(join(lease.workspace.directory, 'notes.md'))
    await restarted.remove(pull, pull.headSha)
    expect(restarted.status(pull, pull.headSha).status).toBe('absent')
  })

  it('resolves aliases, enum declarations and references using the full local TypeScript project', async () => {
    const { pull, project, workspaces } = await fixture()
    const navigation = new WorkspaceTypeScriptNavigation(project, workspaces)
    cleanup.push(() => navigation.close())
    const request = {
      side: DiffSide.right,
      path: 'src/use.ts',
      line: 2,
      column: 25,
      kind: 'definition' as const,
    }
    const result = await navigation.navigate(pull, request)
    expect(result).toMatchObject({
      source: { sha: pull.headSha, kind: 'local' },
      targets: [{ path: 'src/types.ts', line: 1, name: 'Purpose' }],
    })
    const references = await navigation.navigate(pull, { ...request, kind: 'references' })
    expect(
      references.targets.some((target) => target.path === 'src/use.ts' && target.line === 2),
    ).toBe(true)
    expect(references.targets.some((target) => target.path === 'src/unrelated.ts')).toBe(false)
    expect((await navigation.navigate(pull, { ...request, side: DiffSide.left })).source?.sha).toBe(
      pull.mergeBaseSha,
    )
  }, 20_000)

  it('finds references beyond the old snapshot bound and resolves workspace package exports', async () => {
    const files: Record<string, string> = {
      'packages/domain/package.json':
        '{"name":"@example/domain","exports":{".":"./dist/index.js"}}',
      'packages/domain/tsconfig.json':
        '{"compilerOptions":{"rootDir":"src","outDir":"dist","composite":true},"include":["src"]}',
      'packages/domain/src/index.ts': 'export const shared = 7\n',
      'src/package-use.ts':
        "import { shared } from '@example/domain'\nexport const result = shared\n",
    }
    for (let index = 0; index < 135; index++)
      files[`src/references/${index}.ts`] =
        "import { Purpose } from '../types'\nexport const chosen = Purpose.deposit\n"
    const { pull, project, workspaces } = await fixture(files)
    const navigation = new WorkspaceTypeScriptNavigation(project, workspaces)
    cleanup.push(() => navigation.close())
    const references = await navigation.navigate(pull, {
      side: DiffSide.right,
      path: 'src/use.ts',
      line: 2,
      column: 25,
      kind: 'references',
    })
    expect(
      references.targets.some(
        (target) => target.path === 'src/references/134.ts' && target.line === 2,
      ),
    ).toBe(true)
    const definition = await navigation.navigate(pull, {
      side: DiffSide.right,
      path: 'src/package-use.ts',
      line: 2,
      column: 24,
      kind: 'definition',
    })
    expect(definition.targets).toMatchObject([
      { path: 'packages/domain/src/index.ts', name: 'shared' },
    ])
  }, 20_000)

  it('uses a nested jsconfig before an ancestor tsconfig and reports missing configuration', async () => {
    const { pull, project, workspaces } = await fixture({
      'web/jsconfig.json': '{"compilerOptions":{"baseUrl":".","paths":{"@local":["value.js"]}}}',
      'web/value.js': 'export const local = 1\n',
      'web/use.js': "import { local } from '@local'\nexport const result = local\n",
      'broken/tsconfig.json': '{"extends":"missing-package/tsconfig.json"}',
      'broken/use.ts': "import { absent } from 'not-installed'\nexport const result = absent\n",
    })
    const navigation = new WorkspaceTypeScriptNavigation(project, workspaces)
    cleanup.push(() => navigation.close())
    const result = await navigation.navigate(pull, {
      side: DiffSide.right,
      path: 'web/use.js',
      line: 2,
      column: 24,
      kind: 'definition',
    })
    expect(result.targets).toMatchObject([{ path: 'web/value.js', name: 'local' }])
    const unresolved = await navigation.navigate(pull, {
      side: DiffSide.right,
      path: 'broken/use.ts',
      line: 2,
      column: 24,
      kind: 'definition',
    })
    expect(unresolved.targets).toEqual([])
    expect(unresolved.warnings.join(' ')).toContain('missing-package')
    expect(unresolved.warnings.join(' ')).toContain('not-installed')
  }, 20_000)

  it('runs an installed stdio language server in the complete saved checkout', async () => {
    const { pull, project, workspaces } = await fixture({
      'use.go': '😀 run()',
      'service.go': '😀 run declaration',
      'tool/config.json': '{"languageSpecificSetting":true}',
    })
    const server = {
      language: 'go',
      extensions: ['go'],
      command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/language-server.mjs', import.meta.url))],
    }
    const request = {
      side: DiffSide.right,
      path: 'use.go',
      line: 1,
      column: 4,
      kind: 'definition' as const,
    }
    const workspace = await createSourceWorkspace(project, pull, request, server, workspaces)
    cleanup.push(workspace.close)
    expect(await readFile(join(workspace.directory, 'tool/config.json'), 'utf8')).toContain(
      'languageSpecificSetting',
    )
    const session = await startLanguageServer(server, process.execPath, workspace)
    cleanup.push(session.close)
    expect((await session.navigate(request)).targets).toMatchObject([
      { path: 'service.go', name: 'run' },
    ])
    await session.close()
    expect(await readFile(join(workspace.directory, 'use.go'), 'utf8')).toContain('run')
    // The synthetic server writes a diagnostic record; production cleanup
    // must preserve such unexpected files until explicitly removed.
    await expect(workspaces.remove(pull, pull.headSha)).rejects.toThrow('changes')
  }, 20_000)

  it('exposes authenticated read-only MCP tools with the same semantic results as the UI', async () => {
    const { pull, project, workspaces } = await fixture()
    const semantic = new WorkspaceTypeScriptNavigation(project, workspaces)
    cleanup.push(() => semantic.close())
    const navigate = createSourceNavigator(project, undefined, semantic)
    cleanup.push(async () => {
      navigate.close()
    })
    const lease = await workspaces.acquire(pull, pull.headSha)
    const context = await startRepositoryTools(pull, lease, project, navigate)
    cleanup.push(() => context.close())
    let id = 0
    const call = async (method: string, params: unknown) =>
      (
        await fetch(context.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${context.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        })
      ).json()
    expect(
      (
        await fetch(context.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(403)
    expect(
      (await call('initialize', { protocolVersion: '2025-03-26' })).result.capabilities,
    ).toEqual({ tools: {} })
    const tools = (await call('tools/list', {})).result.tools
    expect(tools.map((tool: { name: string }) => tool.name)).toContain('go_to_definition')
    expect(
      tools.every(
        (tool: { annotations: { readOnlyHint: boolean } }) => tool.annotations.readOnlyHint,
      ),
    ).toBe(true)
    const search = JSON.parse(
      (await call('tools/call', { name: 'search_text', arguments: { query: 'surrounding' } }))
        .result.content[0].text,
    )
    expect(search).toMatchObject({
      sha: pull.headSha,
      matches: [{ path: 'docs/context.md', line: 1 }],
    })
    const definition = JSON.parse(
      (
        await call('tools/call', {
          name: 'go_to_definition',
          arguments: { path: 'src/use.ts', line: 2, column: 25 },
        })
      ).result.content[0].text,
    )
    expect(definition).toMatchObject({
      sha: pull.headSha,
      source: { kind: 'local' },
      targets: [{ path: 'src/types.ts', name: 'Purpose' }],
    })
    expect(
      (await call('tools/call', { name: 'read_file', arguments: { path: '../outside' } })).result
        .isError,
    ).toBe(true)
    expect(
      (await call('tools/call', { name: 'write_file', arguments: { path: 'src/types.ts' } })).error
        .code,
    ).toBe(-32602)
    await context.close()
    await expect(fetch(context.url)).rejects.toThrow()
  }, 20_000)
})
