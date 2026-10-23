import { createHash } from 'node:crypto'
import type { LocalRound } from '../../../shared/domain/panelFix'
import type { ChangedFile, PullRequest } from '../../../shared/domain/types'
import { hardenedGit } from '../../adapters/git'
import { UserError } from '../../errors'
import { MAX_GIT_OUTPUT_BYTES, MAX_WORKSPACE_STATUS_OUTPUT_BYTES } from '../../limits'
import { detectTransfers, fileGroups, parseFile } from '../diff'

export interface LocalSources {
  /** The PR as GitHub has it, for its title, description and identity. */
  loadPull: (url: string) => Promise<PullRequest>
  /** Copy the local commit where reviews read source from. */
  importCommit: (pull: PullRequest, local: LocalRound) => Promise<void>
  /** Fill in the files' original contents at the merge base, when source is available. */
  originals?: (pull: PullRequest, files: ChangedFile[]) => Promise<void>
}

/** How a round loads its PRs: a local round's PR from its fix commits, any other from GitHub. */
export function roundLoader(
  local: LocalRound | undefined,
  sources: {
    loadPull: (url: string) => Promise<PullRequest>
    loadLocal?: (local: LocalRound) => Promise<PullRequest>
  },
) {
  const { loadLocal } = sources
  return (url: string) =>
    local && loadLocal && url === local.url ? loadLocal(local) : sources.loadPull(url)
}

/** The fix branch's committed head, once it has fixes and nothing left unsaved. */
export async function committedFixes(worktreePath: string, reviewedSha: string): Promise<string> {
  await requireClean(worktreePath)
  const head = (await git(worktreePath, ['rev-parse', '--verify', 'HEAD'])).trim()
  if (head === reviewedSha)
    throw new UserError('The fix thread has not committed anything yet. Review it once it has.')
  try {
    await git(worktreePath, ['merge-base', '--is-ancestor', reviewedSha, head])
  } catch {
    throw new UserError('The fix branch no longer starts from the reviewed commit.')
  }
  return head
}

/**
 * The PR as its local fix commits leave it: GitHub's title and description, with the files and
 * diff from the reviewed merge base to the local head. It never reads uncommitted work.
 */
export async function localSnapshot(local: LocalRound, sources: LocalSources) {
  const remote = await sources.loadPull(local.url)
  await requireClean(local.worktreePath)
  const head = (await git(local.worktreePath, ['rev-parse', '--verify', 'HEAD'])).trim()
  if (head !== local.sha)
    throw new UserError(
      `${local.branch} has new commits since this round started. Start Review local fixes again.`,
    )
  await sources.importCommit(remote, local)
  const files = await changedFiles(local)
  await sources.originals?.({ ...remote, mergeBaseSha: local.mergeBaseSha }, files)
  const count = (
    await git(local.worktreePath, ['rev-list', '--count', `${local.reviewedSha}..${local.sha}`])
  ).trim()
  return {
    ...remote,
    id: createHash('sha256')
      .update(`${remote.owner}/${remote.repo}/${String(remote.number)}/local/${local.sha}`)
      .digest('hex')
      .slice(0, 24),
    headSha: local.sha,
    headBranch: local.branch,
    mergeBaseSha: local.mergeBaseSha,
    files,
    groups: fileGroups(files),
    transfers: detectTransfers(files),
    groupingSource: 'files' as const,
    warnings: [
      `This round reviews ${count} local fix ${count === '1' ? 'commit' : 'commits'} on ${local.branch} that GitHub does not have.`,
      ...files
        .filter((file) => file.coverage !== 'complete')
        .map((file) => `${file.path} has no readable patch.`),
    ],
  }
}

const statuses: Record<string, string> = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  R: 'renamed',
  C: 'copied',
  T: 'changed',
}

async function changedFiles(local: LocalRound): Promise<ChangedFile[]> {
  const range = [local.mergeBaseSha, local.sha]
  const listing = await git(local.worktreePath, ['diff', '--name-status', '-z', '-M', ...range])
  const parts = listing.split('\0').filter(Boolean)
  const files: ChangedFile[] = []
  for (let index = 0; index < parts.length;) {
    const code = parts[index++] ?? ''
    const renamed = code.startsWith('R') || code.startsWith('C')
    const previousPath = renamed ? parts[index++] : undefined
    const path = parts[index++] ?? ''
    const patch = await filePatch(
      local,
      [previousPath, path].filter((item) => item !== undefined),
    )
    files.push(
      parseFile({
        path,
        ...(previousPath ? { previousPath } : {}),
        status: statuses[code.charAt(0)] ?? 'modified',
        additions: countLines(patch, '+'),
        deletions: countLines(patch, '-'),
        ...(patch ? { patch } : {}),
      }),
    )
  }
  return files
}

/** One file's hunks as GitHub's API gives them: from the first hunk header, without file headers. */
async function filePatch(local: LocalRound, paths: string[]): Promise<string | undefined> {
  const output = await git(local.worktreePath, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '-M',
    '-U3',
    local.mergeBaseSha,
    local.sha,
    '--',
    ...paths,
  ])
  const start = output.indexOf('\n@@')
  return start < 0 ? undefined : output.slice(start + 1).replace(/\n$/, '')
}

function countLines(patch: string | undefined, sign: '+' | '-') {
  if (!patch) return 0
  return patch.split('\n').filter((line) => line.startsWith(sign)).length
}

async function requireClean(worktreePath: string) {
  const changes = await git(
    worktreePath,
    ['status', '--porcelain', '--untracked-files=all'],
    MAX_WORKSPACE_STATUS_OUTPUT_BYTES,
  )
  if (changes.trim())
    throw new UserError(
      `The fix worktree at ${worktreePath} has unsaved changes. Commit or remove them before reviewing the fixes.`,
    )
}

function git(directory: string, args: string[], maxOutputBytes = MAX_GIT_OUTPUT_BYTES) {
  return hardenedGit(directory, args, { maxOutputBytes })
}
