import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ChatHosts } from '../server/adapters/t3Engine/chatHosts'
import type { EngineThreadOperations } from '../server/adapters/t3Engine/engineThreads'
import { UserError } from '../server/errors'
import { FixChecks } from '../server/features/panel/fixCheck'
import { PanelFixes } from '../server/features/panel/panelFixes'
import { gateRevision } from '../shared/domain/panelGate'
import {
  companion,
  everyone,
  panelHarness,
  primary,
  reply,
  repository,
  url,
} from './fixtures/panelJobs'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

const harness = panelHarness()
const worktree = { path: '/fixes/example/12-a7f239d', branch: 'slopbusters/fix-12-a7f239d' }

async function reviewed(options: { current?: ReturnType<typeof fixturePull> } = {}) {
  const { turns } = recordingTurns(reply)
  const jobs = harness.panel(turns)
  const session = await jobs.start(repository, [url], everyone)
  await vi.waitFor(() => {
    expect(jobs.get(session.id).status).toBe('complete')
  })
  const startThread = vi.fn().mockResolvedValue(undefined)
  const open = vi.fn().mockResolvedValue(undefined)
  const hosts: ChatHosts = {
    workspaceFor: vi.fn().mockResolvedValue({
      location: 'slopbusters',
      threads: { startThread } as unknown as EngineThreadOperations,
      project: { id: 'project-1', title: 'example', workspaceRoot: '/engine/example' },
      open,
    }),
  }
  const prepareWorktree = vi.fn().mockResolvedValue(worktree)
  const start = vi.fn().mockResolvedValue({ id: 'local-round' })
  const fixes = new PanelFixes({
    jobs: { start },
    store: harness.store.panel,
    hosts,
    loadPull: () => Promise.resolve(options.current ?? fixturePull()),
    model: () => primary,
    prepareWorktree,
  })
  const result = () => harness.store.panel.get(session.id)?.results[0]
  const revision = () => gateRevision(result()?.fingerprint ?? '', result()?.gate)
  return { id: session.id, fixes, startThread, open, prepareWorktree, result, revision, start }
}

describe('sending the chosen fixes to a fix thread', () => {
  it('starts one thread in a worktree of the reviewed head, seeded with every plan in full', async () => {
    const { id, fixes, startThread, prepareWorktree, result, revision } = await reviewed()

    await fixes.proceed(id, url, revision())

    const pull = fixturePull()
    expect(prepareWorktree).toHaveBeenCalledWith('/engine/example', pull, pull.headSha)
    const thread = startThread.mock.calls[0]?.[0] as Record<string, unknown> & { message: string }
    expect(thread).toMatchObject({
      branch: worktree.branch,
      worktreePath: worktree.path,
      model: { instanceId: 'claudeAgent', model: primary.model },
      pullRequest: { number: pull.number, url: pull.url },
    })
    expect(thread.message).toContain(`HEAD must be \`${pull.headSha}\``)
    expect(thread.message).toContain('Plan: Reuse the audit helper.')
    expect(thread.message).toContain('Never push')
    expect(result()?.handoff).toMatchObject({
      state: 'sent',
      entries: ['g1'],
      threadId: thread.threadId,
      launch: { branch: worktree.branch, reviewedSha: pull.headSha },
    })
  })

  it('launches once however often Proceed is pressed for the same choices', async () => {
    const { id, fixes, startThread, revision } = await reviewed()

    await Promise.all([fixes.proceed(id, url, revision()), fixes.proceed(id, url, revision())])
    await fixes.proceed(id, url, revision())

    expect(startThread).toHaveBeenCalledTimes(1)
  })

  it('refuses choices the author did not see, and a PR that moved since the review', async () => {
    const moved = { ...fixturePull(), headSha: 'b'.repeat(40) }
    const stale = await reviewed()
    const pushed = await reviewed({ current: moved })

    await expect(stale.fixes.proceed(stale.id, url, 'gate:old')).rejects.toThrow(/choices changed/)
    await expect(pushed.fixes.proceed(pushed.id, url, pushed.revision())).rejects.toThrow(
      /new commits since the panel reviewed it/,
    )
    expect(pushed.prepareWorktree).not.toHaveBeenCalled()
    expect(pushed.result()?.handoff).toBeUndefined()
  })

  it('records a failed launch and retries it on the same thread id', async () => {
    const { id, fixes, startThread, prepareWorktree, result, revision } = await reviewed()
    prepareWorktree.mockRejectedValueOnce(new UserError('The fix worktree has changes.'))

    await expect(fixes.proceed(id, url, revision())).rejects.toThrow(/has changes/)
    const failed = result()?.handoff
    await fixes.proceed(id, url, revision())

    expect(failed).toMatchObject({ state: 'failed', error: 'The fix worktree has changes.' })
    expect(startThread).toHaveBeenCalledTimes(1)
    expect((startThread.mock.calls[0]?.[0] as { threadId: string }).threadId).toBe(failed?.threadId)
    expect(result()?.handoff?.state).toBe('sent')
  })
})

/** Point the sent handoff at a real worktree whose branch has one fix commit after the review. */
function committedFix(id: string) {
  const directory = mkdtempSync(join(tmpdir(), 'panel-fixes-'))
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'T',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 'T',
        GIT_COMMITTER_EMAIL: 't@example.com',
      },
    }).trim()
  git('init', '--quiet')
  git('commit', '--quiet', '--allow-empty', '-m', 'Reviewed')
  const reviewedSha = git('rev-parse', 'HEAD')
  writeFileSync(join(directory, 'a.ts'), 'export const a = 1\n')
  git('add', '.')
  git('commit', '--quiet', '-m', 'Fix')
  const saved = harness.store.panel.get(id)
  const launch = saved?.results[0]?.handoff?.launch
  if (saved && launch) {
    launch.worktreePath = directory
    launch.reviewedSha = reviewedSha
    harness.store.panel.save(saved)
  }
  return {
    directory,
    reviewedSha,
    sha: git('rev-parse', 'HEAD'),
    remove: () => {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

describe('reviewing the fixes once the thread committed them', () => {
  it('starts a round with the same panel over the fix branch’s local head', async () => {
    const { id, fixes, result, revision, start } = await reviewed()
    await fixes.proceed(id, url, revision())
    const fix = committedFix(id)

    await fixes.reviewLocal(id, url)

    expect(start.mock.calls[0]?.[3]).toMatchObject({
      local: {
        url,
        worktreePath: fix.directory,
        sha: fix.sha,
        reviewedSha: fix.reviewedSha,
        from: id,
      },
    })
    expect(result()?.handoff?.state).toBe('sent')
    fix.remove()
  })

  it('asks the other provider whether each sent plan was applied, at the local commit', async () => {
    const { id, fixes, result, revision } = await reviewed()
    await fixes.proceed(id, url, revision())
    const fix = committedFix(id)
    const { turns, requests } = recordingTurns(() => ({
      summary: 'The audit helper is used.',
      results: [
        {
          entry: 'g1',
          status: 'applied',
          note: 'The handler calls writeAudit.',
          evidence: ['src/a.ts:1'],
        },
      ],
    }))
    const loadLocal = vi.fn().mockResolvedValue({ ...fixturePull(), headSha: fix.sha })
    const checks = new FixChecks({
      store: harness.store.panel,
      turns,
      checker: () => companion,
      loadLocal,
    })

    await checks.check(id, url)

    expect(loadLocal).toHaveBeenCalledWith(expect.objectContaining({ sha: fix.sha }))
    expect(requests[0]?.model).toEqual(companion)
    expect(requests[0]?.prompt).toContain('"plan":"Reuse the audit helper."')
    expect(result()?.handoff?.check).toMatchObject({
      sha: fix.sha,
      results: [{ entry: 'g1', status: 'applied' }],
    })
    fix.remove()
  })
})
