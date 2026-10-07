import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PullRequest } from '../../shared/domain/types'
import type { GandalfTask, GandalfTurn } from '../../shared/domain/gandalf'
import { MAX_FILE_BYTES, MAX_GANDALF_PROMPT_BYTES } from '../limits'
import { UserError } from '../errors'
import type { GitHub } from './github'
import { hardenedGit } from './git'
import { workspacePath } from './workspacePath'
import { BaseAdvancedError, readConflictRevision, verifyConflictRevision } from './conflictRevision'
import { conflictIndex } from './conflictIndex'
import { createConflictChoices } from './conflictChoices'

export interface ConflictSnapshot {
  revision: string
  diff: string
  conflicts: {
    path: string
    content: string
    choices?: { side: 'head' | 'base'; type: 'file' | 'symlink'; content: string }[]
  }[]
}
export interface ConflictWorkspace {
  directory: string
  pull: PullRequest
  needsUpdate: boolean
  conflicts: string[]
  verify: (headSha?: string) => Promise<void>
  inspect: () => Promise<ConflictSnapshot>
  apply: (edits: GandalfTurn['edits'], selections?: GandalfTurn['selections']) => Promise<void>
  publish: () => Promise<string>
  close: () => Promise<void>
}
interface Options {
  dataDirectory: string
  pull: PullRequest
  github: GitHub
  signal: AbortSignal
  task?: GandalfTask
  remoteUrl?: (repository: string) => string
}

/** A separate repository merges the base into the PR; only reviewed content is published. */
export async function openConflictWorkspace(options: Options): Promise<ConflictWorkspace> {
  const { signal, github } = options
  const root = join(options.dataDirectory, 'conflict-workspaces')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'gandalf-'))
  const git = (args: string[], network?: 'fetch') =>
    hardenedGit(directory, args, { signal, network })
  try {
    const revision = await readConflictRevision(github, options.pull, signal)
    const pull = { ...options.pull, headSha: revision.headSha, baseSha: revision.baseSha }
    const verify = (headSha = revision.headSha) =>
      verifyConflictRevision(github, pull, { ...revision, headSha }, signal)
    const remote =
      options.remoteUrl ?? ((repository: string) => `https://github.com/${repository}.git`)
    await git(['init', '--template=', '--initial-branch=gandalf'])
    await git(['check-ref-format', `refs/heads/${pull.headBranch}`])
    await fetchCommit(git, remote(revision.headRepository), pull.headSha)
    await fetchCommit(git, remote(revision.baseRepository), pull.baseSha)
    await git(['checkout', '--quiet', '--detach', pull.headSha])
    const needsUpdate = Boolean(
      (await git(['rev-list', '--max-count=1', `${pull.headSha}..${pull.baseSha}`])).trim(),
    )
    const conflicts = await mergeBase(git, pull.baseSha)
    await verify()
    const {
      regular: allowed,
      structural,
      tracked,
    } = conflictIndex(await git(['ls-files', '--stage', '-z']))
    const choices = createConflictChoices(directory, git, structural, pull)
    for (const path of conflicts)
      if (!allowed.has(path) && !structural.has(path))
        throw new UserError(`Gandalf cannot automatically resolve this file type: ${path}.`)
    return workspaceOperations({
      directory,
      pull,
      conflicts,
      needsUpdate,
      verify,
      allowed,
      task: options.task ?? 'conflicts',
      tracked,
      choices,
      git,
      publish: async () => {
        // The push also has an atomic head lease; this check covers a changed base or closed PR.
        // A base that only gained commits still contains the reviewed merge parent, so the
        // resolution is published and the job's final check merges the newer commits.
        await verify().catch((error: unknown) => {
          if (!(error instanceof BaseAdvancedError)) throw error
        })
        const tree = (await git(['write-tree'])).trim()
        if (!needsUpdate && tree === (await git(['rev-parse', `${pull.headSha}^{tree}`])).trim())
          return pull.headSha
        const parents = needsUpdate ? [pull.headSha, pull.baseSha] : [pull.headSha]
        const sha = (
          await git([
            '-c',
            'user.name=Gandalf',
            '-c',
            'user.email=gandalf@slopbusters.local',
            'commit-tree',
            tree,
            ...parents.flatMap((parent) => ['-p', parent]),
            '-m',
            commitMessage(options.task ?? 'conflicts', pull, needsUpdate),
          ])
        ).trim()
        signal.throwIfAborted()
        await pushResolution(directory, remote(revision.headRepository), pull, sha)
        return sha
      },
    })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function commitMessage(task: GandalfTask, pull: PullRequest, merged: boolean) {
  if (task === 'conflicts') return `Resolve merge conflicts for PR #${pull.number}`
  return merged
    ? `Merge ${pull.baseBranch} and fix CI for PR #${pull.number}`
    : `Fix CI for PR #${pull.number}`
}

/** The lease rejects the push if the PR head moved after the workspace fetched it. */
async function pushResolution(directory: string, remote: string, pull: PullRequest, sha: string) {
  await hardenedGit(
    directory,
    [
      '-c',
      'credential.helper=',
      '-c',
      'credential.helper=!gh auth git-credential',
      'push',
      '--porcelain',
      `--force-with-lease=refs/heads/${pull.headBranch}:${pull.headSha}`,
      remote,
      `${sha}:refs/heads/${pull.headBranch}`,
    ],
    { network: 'push' },
  )
}
async function fetchCommit(
  git: (args: string[], network?: 'fetch') => Promise<string>,
  remote: string,
  sha: string,
) {
  if (!/^[a-f\d]{40,64}$/.test(sha)) throw new UserError('Invalid PR revision.')
  await git(
    [
      '-c',
      'credential.helper=',
      '-c',
      'credential.helper=!gh auth git-credential',
      'fetch',
      '--quiet',
      '--no-tags',
      '--no-recurse-submodules',
      remote,
      sha,
    ],
    'fetch',
  )
}
async function mergeBase(git: (args: string[]) => Promise<string>, sha: string) {
  try {
    await git([
      '-c',
      'user.name=Gandalf',
      '-c',
      'user.email=gandalf@slopbusters.local',
      'merge',
      '--no-commit',
      '--no-ff',
      sha,
    ])
  } catch (error) {
    if (!(await git(['ls-files', '--unmerged'])).trim()) throw error
  }
  return (await git(['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean)
}
/** Fixing CI may need a new fixture or test file, but never weaker CI configuration. */
async function admitCiEdit(
  directory: string,
  edit: GandalfTurn['edits'][number],
  allowed: Set<string>,
  tracked: Set<string>,
) {
  if (/^\.github(\/|$)/i.test(edit.path))
    throw new UserError(`Gandalf does not change CI configuration: ${edit.path}.`)
  if (allowed.has(edit.path) || !creatable(edit.path, tracked)) return
  if (edit.content === null)
    throw new UserError(`The resolution deletes a file that does not exist: ${edit.path}.`)
  await mkdir(dirname(safePath(directory, edit.path, new Set([edit.path]))), { recursive: true })
  allowed.add(edit.path)
}
/** A new file may not replace a tracked path or sit beneath a tracked file. */
function creatable(path: string, tracked: Set<string>) {
  if (tracked.has(path)) return false
  const parts = path.split('/')
  return parts.slice(0, -1).every((_, index) => !tracked.has(parts.slice(0, index + 1).join('/')))
}
function safePath(directory: string, path: string, allowed: Set<string>) {
  if (
    !allowed.has(path) ||
    path.split('/').some((part) => ['.git', '.', '..'].includes(part.toLowerCase()))
  )
    throw new UserError(`The resolution includes an unsupported file: ${path}.`)
  return workspacePath(directory, path)
}
async function textFile(directory: string, path: string, allowed: Set<string>) {
  const target = safePath(directory, path, allowed)
  try {
    const info = await lstat(target)
    if (!info.isFile() || info.size > MAX_FILE_BYTES)
      throw new UserError(`Cannot resolve this file automatically: ${path}.`)
    const content = await readFile(target, 'utf8')
    if (content.includes('\0') || content.includes('\uFFFD'))
      throw new UserError(`Cannot resolve binary content: ${path}.`)
    return content
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  }
}
function workspaceOperations(options: {
  directory: string
  pull: PullRequest
  conflicts: string[]
  needsUpdate: boolean
  verify: (headSha?: string) => Promise<void>
  allowed: Set<string>
  task: GandalfTask
  tracked: Set<string>
  choices: ReturnType<typeof createConflictChoices>
  git: (args: string[]) => Promise<string>
  publish: () => Promise<string>
}): ConflictWorkspace {
  const { directory, pull, conflicts, allowed, git } = options
  return {
    directory,
    pull,
    conflicts,
    needsUpdate: options.needsUpdate,
    verify: options.verify,
    async inspect() {
      const diff = await git(['diff', '--no-ext-diff', '--no-textconv', pull.headSha, '--'])
      const files = await Promise.all(
        conflicts.map(async (path) =>
          allowed.has(path)
            ? {
                path,
                content: await textFile(directory, path, allowed),
              }
            : options.choices.inspect(path),
        ),
      )
      const data = JSON.stringify({ diff, conflicts: files })
      if (Buffer.byteLength(data) > MAX_GANDALF_PROMPT_BYTES)
        throw new UserError('These conflicts exceed the automatic resolution size limit.')
      return { revision: createHash('sha256').update(data).digest('hex'), diff, conflicts: files }
    },
    async apply(edits, selections = []) {
      if (new Set(edits.map((edit) => edit.path)).size !== edits.length)
        throw new UserError('The model returned duplicate file edits.')
      for (const edit of edits) {
        if (options.task === 'ci') await admitCiEdit(directory, edit, allowed, options.tracked)
        const target = safePath(directory, edit.path, allowed)
        await textFile(directory, edit.path, allowed)
        if (
          edit.content !== null &&
          (Buffer.byteLength(edit.content) > MAX_FILE_BYTES ||
            edit.content.includes('\0') ||
            /^([<]{7}|[=]{7}|[>]{7})( |$)/m.test(edit.content))
        )
          throw new UserError(
            `The resolution has invalid content or conflict markers: ${edit.path}.`,
          )
        if (edit.content === null) await rm(target, { force: true })
        else await writeFile(target, edit.content)
        await git(['add', '--all', '--', edit.path])
      }
      await options.choices.apply(selections)
      if ((await git(['ls-files', '--unmerged'])).trim())
        throw new UserError('The model left unresolved conflicts. Retry the resolution.')
      await git(['diff', '--cached', '--check'])
    },
    publish: options.publish,
    close: () => rm(directory, { recursive: true, force: true }),
  }
}
