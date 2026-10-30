import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { prepareFixWorktree } from '../../../server/adapters/fixWorktrees'

const pull = { owner: 'review-room', repo: 'example', number: 12 }
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

/** A checkout on main with one commit, and a later commit the PR's head points at. */
function repository(name: string) {
  const directory = join(home, name)
  execFileSync('git', ['init', '--quiet', '--initial-branch=main', directory])
  writeFileSync(join(directory, 'a.ts'), 'export const a = 1\n')
  git(directory, 'add', '.')
  git(directory, 'commit', '--quiet', '-m', 'Start')
  return directory
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'fix-worktrees-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('a fix worktree', () => {
  it('starts a new branch at the reviewed head and leaves the checkout as it was', async () => {
    const checkout = repository('checkout')
    const sha = git(checkout, 'rev-parse', 'HEAD')
    writeFileSync(join(checkout, 'a.ts'), 'export const a = 2\n')

    const worktree = await prepareFixWorktree(checkout, pull, sha, { root: join(home, 'fixes') })

    expect(worktree.branch).toBe(`slopbusters/fix-12-${sha.slice(0, 7)}`)
    expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(sha)
    expect(git(worktree.path, 'branch', '--show-current')).toBe(worktree.branch)
    expect(git(checkout, 'branch', '--show-current')).toBe('main')
    expect(git(checkout, 'status', '--porcelain')).toBe('M a.ts')
  })

  it('fetches a reviewed head the checkout does not have', async () => {
    const remote = repository('remote')
    const checkout = join(home, 'clone')
    execFileSync('git', ['clone', '--quiet', remote, checkout])
    writeFileSync(join(remote, 'b.ts'), 'export const b = 1\n')
    git(remote, 'add', '.')
    git(remote, 'commit', '--quiet', '-m', 'Head')
    const sha = git(remote, 'rev-parse', 'HEAD')

    const worktree = await prepareFixWorktree(checkout, pull, sha, {
      root: join(home, 'fixes'),
      remoteUrl: () => remote,
    })

    expect(git(worktree.path, 'rev-parse', 'HEAD')).toBe(sha)
  })

  it('is reused while untouched, and refused once it has changes or commits', async () => {
    const checkout = repository('checkout')
    const sha = git(checkout, 'rev-parse', 'HEAD')
    const options = { root: join(home, 'fixes') }
    const first = await prepareFixWorktree(checkout, pull, sha, options)

    expect(await prepareFixWorktree(checkout, pull, sha, options)).toEqual(first)
    writeFileSync(join(first.path, 'a.ts'), 'export const a = 3\n')
    await expect(prepareFixWorktree(checkout, pull, sha, options)).rejects.toThrow(/has changes/)
    git(first.path, 'commit', '--quiet', '-am', 'Fix')
    await expect(prepareFixWorktree(checkout, pull, sha, options)).rejects.toThrow(
      /no longer at the reviewed commit/,
    )
  })
})
