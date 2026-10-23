import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fixBranch } from '../../shared/domain/panelFix'
import type { PullRequest } from '../../shared/domain/types'
import { UserError } from '../errors'
import { MAX_WORKSPACE_STATUS_OUTPUT_BYTES } from '../limits'
import { hardenedGit } from './git'
import { validateSourceIdentity } from './sourceRepository'

export interface FixWorktree {
  readonly path: string
  readonly branch: string
}

export interface FixWorktreeOptions {
  /** Where fix worktrees live, outside every checkout. */
  readonly root: string
  readonly remoteUrl?: (owner: string, repo: string) => string
}

/**
 * A fix thread's own worktree of the project checkout, on a new branch at the reviewed head. The
 * user's checkout, its branches and local changes are left alone; nothing here pushes.
 */
export async function prepareFixWorktree(
  checkout: string,
  pull: Pick<PullRequest, 'owner' | 'repo' | 'number'>,
  sha: string,
  options: FixWorktreeOptions,
): Promise<FixWorktree> {
  validateSourceIdentity(pull.owner, pull.repo, sha)
  const branch = fixBranch(pull, sha)
  const path = join(options.root, pull.owner, pull.repo, `${String(pull.number)}-${sha}`)
  if (await exists(path)) {
    await verifyFixWorktree(path, sha)
    return { path: await realpath(path), branch }
  }
  if (!(await hasCommit(checkout, sha))) await fetchCommit(checkout, pull, sha, options)
  try {
    await git(checkout, ['worktree', 'add', '--quiet', '-b', branch, path, sha])
  } catch {
    throw new UserError(
      `Could not add a worktree on ${branch}. If that branch is left from an earlier fix, delete it and try again.`,
    )
  }
  await verifyFixWorktree(path, sha)
  return { path: await realpath(path), branch }
}

/** A fix starts only on the reviewed commit with nothing changed. */
async function verifyFixWorktree(path: string, sha: string) {
  const head = (await git(path, ['rev-parse', '--verify', 'HEAD'])).trim()
  if (head !== sha)
    throw new UserError(
      `The fix worktree at ${path} is no longer at the reviewed commit. Its files have been preserved.`,
    )
  const changes = await git(
    path,
    ['status', '--porcelain', '--untracked-files=all'],
    MAX_WORKSPACE_STATUS_OUTPUT_BYTES,
  )
  if (changes.trim())
    throw new UserError(
      `The fix worktree at ${path} has changes. Its files have been preserved; save or remove them before retrying.`,
    )
}

async function hasCommit(checkout: string, sha: string) {
  try {
    await git(checkout, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

async function fetchCommit(
  checkout: string,
  pull: Pick<PullRequest, 'owner' | 'repo' | 'number'>,
  sha: string,
  options: FixWorktreeOptions,
) {
  const remote =
    options.remoteUrl?.(pull.owner, pull.repo) ??
    `https://github.com/${pull.owner}/${pull.repo}.git`
  try {
    await hardenedGit(
      checkout,
      [
        '-c',
        'credential.helper=',
        '-c',
        'credential.helper=!gh auth git-credential',
        'fetch',
        '--quiet',
        '--no-tags',
        '--no-recurse-submodules',
        '--no-write-fetch-head',
        remote,
        sha,
      ],
      { network: 'fetch', maxOutputBytes: 4096 },
    )
  } catch {
    throw new UserError(`Could not fetch the reviewed commit of PR #${String(pull.number)}.`)
  }
  if (!(await hasCommit(checkout, sha)))
    throw new UserError(`The reviewed commit of PR #${String(pull.number)} is not available.`)
}

function git(directory: string, args: string[], maxOutputBytes = 4096) {
  return hardenedGit(directory, args, { maxOutputBytes })
}

async function exists(path: string) {
  try {
    await realpath(path)
    return true
  } catch {
    return false
  }
}
