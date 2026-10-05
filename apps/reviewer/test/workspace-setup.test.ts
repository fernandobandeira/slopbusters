import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../server/process'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/store'
import { DiffSide, Provider } from '../shared/types'
import { workspaceSetupSchema, type SetupPlan, type WorkspaceSetup } from '../shared/workspaceSetup'
import { fixturePull } from './fixtures/pull'
import { PreparedEnvironmentStorage } from '../server/adapters/preparedEnvironment'
import { LocalSourceRepository } from '../server/sourceRepository'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function fixture(plan: SetupPlan) {
  const directory = await mkdtemp(join(tmpdir(), 'review-setup-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const origin = join(directory, 'origin')
  await mkdir(join(origin, 'src'), { recursive: true })
  await writeFile(join(origin, '.gitignore'), 'node_modules/\n')
  await writeFile(
    join(origin, 'tsconfig.json'),
    JSON.stringify({
      extends: 'base-config',
      compilerOptions: { baseUrl: '.', paths: { '@domain/*': ['src/*'] } },
    }),
  )
  await writeFile(join(origin, 'src/types.ts'), 'export const chosen = 7\n')
  await writeFile(
    join(origin, 'src/use.ts'),
    "import { chosen } from '@domain/types'\nexport const value = chosen\n",
  )
  await writeFile(
    join(origin, 'src/generated-use.ts'),
    "import { Purpose } from 'generated-client'\nexport const chosen = Purpose.deposit\n",
  )
  const git = (...args: string[]) =>
    runCommand({
      command: 'git',
      cwd: origin,
      args: ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', ...args],
    })
  await git('init', '--template=', '--initial-branch=main')
  await git('add', '.')
  await git('commit', '-m', 'Fixture')
  const sha = (await git('rev-parse', 'HEAD')).trim()
  const pull = { ...fixturePull(), headSha: sha, baseSha: sha, mergeBaseSha: sha }
  await writeFile(join(origin, 'src/types.ts'), 'export const chosen = "user work"\n')
  const data = join(directory, 'data')
  const store = new ReviewerStore({ dataDirectory: data })
  store.savePull(pull)
  store.close()
  const app = await startReviewerServer({
    dataDirectory: data,
    staticDirectory: data,
    port: 0,
    sourceRemoteUrl: () => pathToFileURL(origin).href,
    workspaceSetupPlanner: async () => plan,
  })
  cleanup.push(() => app.close())
  const request = (path: string, method = 'GET', body?: unknown) =>
    fetch(`${app.url}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const start = async () =>
    workspaceSetupSchema.parse(
      await (
        await request(`/pulls/${pull.id}/workspace-setup`, 'POST', {
          side: DiffSide.right,
          provider: Provider.codex,
          path: 'src/use.ts',
          warnings: ['Missing base-config'],
        })
      ).json(),
    )
  const wait = async (id: string, predicate: (job: WorkspaceSetup) => boolean) => {
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      const job = workspaceSetupSchema.parse(
        await (await request(`/workspace-setups/${id}`)).json(),
      )
      if (predicate(job)) return job
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error('Setup did not reach its expected state.')
  }
  const approve = (id: string, approved = true) =>
    request(`/pulls/${pull.id}/workspace-setup/${id}/approve`, 'POST', {
      side: DiffSide.right,
      approved,
    })
  return { directory, data, origin, pull, app, request, start, wait, approve }
}
const nodeStep = (code: string) => ({
  command: process.execPath,
  args: ['-e', code],
  directory: '.',
  reason: 'Prepare fixture dependencies.',
})

describe('approved disposable workspace setup', () => {
  it('reclaims dead-process orphans at startup and preserves live sessions', async () => {
    const data = await mkdtemp(join(tmpdir(), 'review-setup-orphans-'))
    cleanup.push(() => rm(data, { recursive: true, force: true }))
    const dead = join(data, 'prepared-environments', '2147483647-orphan')
    const live = join(data, 'prepared-environments', `${process.pid}-live`)
    await mkdir(dead, { recursive: true })
    await mkdir(live, { recursive: true })
    await writeFile(join(dead, 'dependency'), 'Abandoned setup')
    await writeFile(join(live, 'dependency'), 'Active setup')
    const repository = new LocalSourceRepository(data)
    cleanup.push(() => repository.close())
    const storage = new PreparedEnvironmentStorage(data, repository)
    await storage.initialize()
    await expect(stat(dead)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(live, 'dependency'), 'utf8')).toBe('Active setup')
    await storage.close()
    expect(await readFile(join(live, 'dependency'), 'utf8')).toBe('Active setup')
  })

  it('retains an environment while navigating and expires it after inactivity', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    const f = await fixture({
      explanation: 'Install fixture dependencies',
      commands: [
        nodeStep("require('node:fs').mkdirSync('node_modules/dependency', { recursive: true })"),
      ],
    })
    const initial = await f.start()
    await f.wait(initial.id, (job) => job.status === 'awaiting-approval')
    await f.approve(initial.id)
    const ready = await f.wait(initial.id, (job) => job.status === 'ready')
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    await f.request(`/pulls/${f.pull.id}/navigation`, 'POST', {
      side: DiffSide.right,
      path: 'src/use.ts',
      line: 2,
      column: 22,
      kind: 'definition',
    })
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect((await f.wait(initial.id, (job) => job.status === 'ready')).directory).toBe(
      ready.directory,
    )
    await vi.advanceTimersByTimeAsync(15 * 60_000)
    await f.wait(initial.id, (job) => job.status === 'cancelled' && !job.directory)
    await expect(stat(ready.directory!)).rejects.toMatchObject({ code: 'ENOENT' })
  }, 20_000)

  it('removes a completed environment on shutdown after retiring its analysis worker', async () => {
    const f = await fixture({
      explanation: 'Install fixture dependencies',
      commands: [
        nodeStep("require('node:fs').mkdirSync('node_modules/dependency', { recursive: true })"),
      ],
    })
    const initial = await f.start()
    await f.wait(initial.id, (job) => job.status === 'awaiting-approval')
    await f.approve(initial.id)
    const ready = await f.wait(initial.id, (job) => job.status === 'ready')
    await f.request(`/pulls/${f.pull.id}/navigation`, 'POST', {
      side: DiffSide.right,
      path: 'src/use.ts',
      line: 2,
      column: 22,
      kind: 'definition',
    })
    await f.app.close()
    await expect(stat(ready.directory!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(join(f.data, 'prepared-environments'))).toEqual([])
  }, 20_000)

  it('requires approval, refreshes analysis, preserves PR/user source, and clears only its own dependencies', async () => {
    const plan: SetupPlan = {
      explanation: 'Install project configuration and generate client declarations.',
      commands: [
        nodeStep(`
      const fs = require('node:fs');
      fs.mkdirSync('node_modules/base-config', {recursive:true});
      fs.writeFileSync('node_modules/base-config/tsconfig.json', '{"compilerOptions":{"strict":true}}');
      fs.mkdirSync('node_modules/generated-client', {recursive:true});
      fs.writeFileSync('node_modules/generated-client/index.d.ts', '/*' + 'x'.repeat(12*1024*1024) + '*/\\nexport declare enum Purpose { deposit = "deposit" }\\n');
      console.log('Generated fixture declarations');
    `),
      ],
    }
    const f = await fixture(plan)
    const navigation = () =>
      f.request(`/pulls/${f.pull.id}/navigation`, 'POST', {
        side: DiffSide.right,
        path: 'src/use.ts',
        line: 2,
        column: 22,
        kind: 'definition',
      })
    const before = await (await navigation()).json()
    expect(before.warnings.join(' ')).toContain('base-config')
    const initial = await f.start()
    const proposed = await f.wait(initial.id, (job) => job.status === 'awaiting-approval')
    expect(proposed.plan).toEqual(plan)
    await expect(stat(join(f.data, 'prepared-environments'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect((await f.approve(initial.id, false)).status).toBe(400)
    expect(
      (
        await f.request(`/pulls/${f.pull.id}/workspace-setup/${initial.id}/approve`, 'POST', {
          side: DiffSide.right,
          approved: true,
          commands: [nodeStep('process.exit(0)')],
        })
      ).status,
    ).toBe(400)
    await expect(stat(join(f.data, 'prepared-environments'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const sharedCache = join(f.directory, 'shared-cache')
    await writeFile(sharedCache, 'Reusable packages')
    expect((await f.approve(initial.id)).status).toBe(202)
    const ready = await f.wait(initial.id, (job) => ['ready', 'failed'].includes(job.status))
    expect(ready, ready.error).toMatchObject({ status: 'ready' })
    expect(ready.log).toContain('Generated fixture declarations')
    const after = await (await navigation()).json()
    expect(after.targets).toMatchObject([{ path: 'src/types.ts', name: 'chosen' }])
    expect(after.warnings.join(' ')).not.toContain("File 'base-config' not found")
    expect(after.warnings.join(' ')).toContain('approved, disposable')
    const external = await (
      await f.request(`/pulls/${f.pull.id}/navigation`, 'POST', {
        side: DiffSide.right,
        path: 'src/generated-use.ts',
        line: 2,
        column: 25,
        kind: 'definition',
      })
    ).json()
    expect(external.targets).toEqual([])
    expect(external.warnings.join(' ')).toContain('configured IDE')
    expect(external.warnings.join(' ')).not.toContain('Cannot resolve generated-client')
    expect(await readFile(join(f.origin, 'src/types.ts'), 'utf8')).toContain('user work')
    const sourceCheckout = join(
      f.data,
      'review-workspaces',
      f.pull.owner,
      f.pull.repo,
      f.pull.headSha,
    )
    await expect(stat(join(sourceCheckout, 'node_modules'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const removed = await f.request(`/workspace-setups/${initial.id}`, 'DELETE')
    expect(removed.status).toBe(200)
    await expect(stat(ready.directory!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(sharedCache, 'utf8')).toBe('Reusable packages')
    expect((await (await navigation()).json()).warnings.join(' ')).toContain('base-config')
  }, 30_000)

  it('refuses setup that edits committed source and deletes its partial environment', async () => {
    const f = await fixture({
      explanation: 'Fixture source change',
      commands: [
        nodeStep("require('node:fs').writeFileSync('src/types.ts', 'export const chosen = 99')"),
      ],
    })
    const initial = await f.start()
    await f.wait(initial.id, (job) => job.status === 'awaiting-approval')
    await f.approve(initial.id)
    const failed = await f.wait(initial.id, (job) => job.status === 'failed')
    expect(failed.error).toContain('changed committed source')
    // Wait for cleanup as well as the published failure state.
    await f.request(`/workspace-setups/${initial.id}`, 'DELETE')
    const sessions = await readdir(join(f.data, 'prepared-environments'))
    expect(await readdir(join(f.data, 'prepared-environments', sessions[0]))).toEqual([])
    expect(await readFile(join(f.origin, 'src/types.ts'), 'utf8')).toContain('user work')
  }, 20_000)

  it('kills a running command before cleanup and leaves no environment on app exit', async () => {
    const f = await fixture({
      explanation: 'Slow fixture setup',
      commands: [
        nodeStep(`
      process.on('SIGTERM', () => {});
      console.log('Setup is running');
      setInterval(() => require('node:fs').writeFileSync('setup-tick', Date.now().toString()), 20);
    `),
      ],
    })
    const initial = await f.start()
    await f.wait(initial.id, (job) => job.status === 'awaiting-approval')
    await f.approve(initial.id)
    const running = await f.wait(initial.id, (job) => job.log.includes('Setup is running'))
    expect((await f.request(`/workspace-setups/${initial.id}`, 'DELETE')).status).toBe(200)
    await expect(stat(running.directory!)).rejects.toMatchObject({ code: 'ENOENT' })
    await f.app.close()
    expect(await readdir(join(f.data, 'prepared-environments'))).toEqual([])
  }, 20_000)

  it('accepts a no-command explanation without ever executing setup', async () => {
    const f = await fixture({
      explanation: 'Generation requires unavailable credentials. Use your configured IDE.',
      commands: [],
    })
    const initial = await f.start()
    const plan = await f.wait(initial.id, (job) => job.status === 'awaiting-approval')
    expect(plan.plan?.commands).toEqual([])
    expect((await f.approve(initial.id)).status).toBe(400)
    await expect(stat(join(f.data, 'prepared-environments'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })
})
