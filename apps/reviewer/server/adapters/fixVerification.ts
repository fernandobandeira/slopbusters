import { hardenedGit } from './git'
import { MAX_GIT_OUTPUT_BYTES, MAX_WORKSPACE_STATUS_OUTPUT_BYTES } from '../limits'
import { UserError } from '../errors'

/** A convenience barrier only: explicit push URLs bypass this; remote-head detection is required. */
export async function preventFixPush(checkout: string): Promise<void> {
  await hardenedGit(checkout, [
    'config',
    '--replace-all',
    'remote.origin.pushurl',
    'https://invalid.invalid/slopbusters-no-push',
  ])
}

/** Retry and final verification share the same clean-tree and ancestry checks. */
export async function fixHead(path: string, start: string): Promise<string> {
  const changes = await hardenedGit(path, ['status', '--porcelain', '--untracked-files=all'], {
    maxOutputBytes: MAX_WORKSPACE_STATUS_OUTPUT_BYTES,
  })
  if (changes.trim())
    throw new UserError(
      'The fix worktree is dirty and has unsaved changes. Commit or remove its changes before retrying.',
    )
  const head = await readFixHead(path)
  try {
    await hardenedGit(path, ['merge-base', '--is-ancestor', start, head])
  } catch {
    throw new UserError(
      'The fix worktree diverged from its starting head. Its files have been preserved.',
    )
  }
  return head
}
export async function readFixHead(path: string): Promise<string> {
  return (await hardenedGit(path, ['rev-parse', '--verify', 'HEAD'])).trim()
}
export async function fixCommits(path: string, start: string, head: string): Promise<string[]> {
  return (
    await hardenedGit(path, ['rev-list', `${start}..${head}`], {
      maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
    })
  )
    .trim()
    .split('\n')
    .filter(Boolean)
}
