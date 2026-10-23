import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareFixWorktree } from '../server/adapters/fixWorktrees'
import { LocalSourceRepository } from '../server/adapters/sourceRepository'
import { committedFixes, localSnapshot } from '../server/features/panel/localRound'
import type { LocalRound } from '../shared/domain/panelFix'
import { fixturePull } from './fixtures/pull'

let home: string

function git(directory: string, ...args: string[]) {
  return execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

function commit(directory: string, file: string, text: string, message: string) {
  writeFileSync(join(directory, file), text)
  git(directory, 'add', '.')
  git(directory, 'commit', '--quiet', '-m', message)
  return git(directory, 'rev-parse', 'HEAD')
}

/** A checkout with the PR's base, its reviewed head, and a fix worktree at that head. */
async function fixWorktree() {
  const checkout = join(home, 'checkout')
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', checkout])
  const base = commit(checkout, 'a.ts', 'export const a = 1\n', 'Base')
  const reviewed = commit(checkout, 'a.ts', 'export const a = 2\n', 'The PR')
  const pull = { ...fixturePull(), owner: 'review-room', repo: 'example', headSha: reviewed }
  const worktree = await prepareFixWorktree(checkout, pull, reviewed, { root: join(home, 'fixes') })
  return { pull, base, reviewed, worktree }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'local-round-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('reviewing the fix thread’s local commits', () => {
  it('waits for committed fixes and refuses unsaved work', async () => {
    const { reviewed, worktree } = await fixWorktree()

    await expect(committedFixes(worktree.path, reviewed)).rejects.toThrow(/not committed anything/)
    writeFileSync(join(worktree.path, 'b.ts'), 'export const b = 1\n')
    await expect(committedFixes(worktree.path, reviewed)).rejects.toThrow(/unsaved changes/)
    const fixed = commit(worktree.path, 'b.ts', 'export const b = 1\n', 'Fix')

    expect(await committedFixes(worktree.path, reviewed)).toBe(fixed)
  })

  it('builds the PR from the merge base to the local head, with GitHub’s description', async () => {
    const { pull, base, reviewed, worktree } = await fixWorktree()
    const fixed = commit(worktree.path, 'b.ts', 'export const b = 1\n', 'Fix')
    const local: LocalRound = {
      url: pull.url,
      worktreePath: worktree.path,
      branch: worktree.branch,
      sha: fixed,
      reviewedSha: reviewed,
      mergeBaseSha: base,
      from: 'panel-1',
    }
    const importCommit = vi.fn().mockResolvedValue(undefined)

    const snapshot = await localSnapshot(local, {
      loadPull: () => Promise.resolve(pull),
      importCommit,
    })

    expect(importCommit).toHaveBeenCalledWith(pull, local)
    expect(snapshot).toMatchObject({ headSha: fixed, headBranch: worktree.branch })
    expect(snapshot.description).toBe(pull.description)
    expect(snapshot.files.map((file) => [file.path, file.status, file.additions])).toEqual([
      ['a.ts', 'modified', 1],
      ['b.ts', 'added', 1],
    ])
    expect(snapshot.files[1]?.hunks[0]?.lines.map((line) => line.text)).toEqual([
      'export const b = 1',
    ])
    expect(snapshot.warnings[0]).toMatch(/1 local fix commit on slopbusters\/fix-/)
  })

  it('reads the local commit as source without GitHub', async () => {
    const { pull, worktree } = await fixWorktree()
    const fixed = commit(worktree.path, 'b.ts', 'export const b = 1\n', 'Fix')
    const repository = new LocalSourceRepository(join(home, 'data'), () => join(home, 'nowhere'))

    await repository.importLocal(
      { owner: pull.owner, repo: pull.repo, sha: fixed },
      { checkout: worktree.path, branch: worktree.branch },
    )
    const snapshot = await repository.snapshot(pull.owner, pull.repo, fixed)

    expect(snapshot.entries.map((entry) => entry.path).sort()).toEqual(['a.ts', 'b.ts'])
  })
})
