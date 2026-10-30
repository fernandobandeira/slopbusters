import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PullRequest } from '../../shared/domain/types'
import type { GandalfTask, GandalfTurn } from '../../shared/domain/gandalf'
import { MAX_FILE_BYTES } from '../limits'
import { UserError } from '../errors'
import { CONFLICT_MARKER, changesInCopy, currentText } from './conflictHarvest'
import { mergeContext, viewsDirectory, type MergeContext } from './conflictMergeContext'
import type { GitHub } from './github'
import { hardenedGit } from './git'
import { workspacePath } from './workspacePath'
import { BaseAdvancedError, readConflictRevision, verifyConflictRevision } from './conflictRevision'
import { conflictIndex } from './conflictIndex'
import { GANDALF_IDENTITY, type GitIdentity } from './gitIdentity'
import { createConflictChoices } from './conflictChoices'

/** Files one turn may change; more means the agent rewrote the merge rather than resolving it. */
const MAX_GANDALF_CHANGED_FILES = 100

export interface ConflictSnapshot {
  /** Changes whenever the merge's files or index change. */
  revision: string
  conflicts: {
    path: string
    /** Every merge conflict stays listed; later turns see which ones are already settled. */
    state: 'unresolved' | 'resolved' | 'deleted'
    /** A file/symlink conflict, settled by choosing a side instead of editing. */
    choices?: { side: 'head' | 'base'; type: 'file' | 'symlink'; content: string }[]
  }[]
}
/** What a turn changed in the merge, and what still blocks agreement on it. */
export interface Absorbed {
  changedPaths: string[]
  problems: string[]
}
type FileEdit = GandalfTurn['edits'][number]
export interface ConflictWorkspace {
  directory: string
  pull: PullRequest
  needsUpdate: boolean
  conflicts: string[]
  merge: MergeContext
  verify: (headSha?: string) => Promise<void>
  inspect: () => Promise<ConflictSnapshot>
  /** Applies what is valid and reports the rest as problems for the agent to fix. */
  apply: (edits: FileEdit[], selections?: GandalfTurn['selections']) => Promise<Absorbed>
  /** Applies what the agent changed in `copy`, a copy of this checkout, plus its reply. */
  absorb: (copy: string, reply: Pick<GandalfTurn, 'edits' | 'selections'>) => Promise<Absorbed>
  publish: () => Promise<string>
  close: () => Promise<void>
}
interface Options {
  dataDirectory: string
  pull: PullRequest
  github: GitHub
  signal: AbortSignal
  task?: GandalfTask
  /** The author of published commits; defaults to Gandalf. */
  identity?: (signal: AbortSignal) => Promise<GitIdentity>
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
    const merge = await mergeContext(git, directory, pull, conflicts)
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
      merge,
      signal,
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
        const author = (await options.identity?.(signal)) ?? GANDALF_IDENTITY
        const sha = (
          await git([
            '-c',
            `user.name=${author.name}`,
            '-c',
            `user.email=${author.email}`,
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
    await rm(viewsDirectory(directory), { recursive: true, force: true })
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
      `user.name=${GANDALF_IDENTITY.name}`,
      '-c',
      `user.email=${GANDALF_IDENTITY.email}`,
      // Markers that also show the common ancestor make each side's intent visible.
      '-c',
      'merge.conflictStyle=zdiff3',
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
async function conflictStates(git: (args: string[]) => Promise<string>) {
  const paths = async (args: string[]) => new Set((await git(args)).split('\0').filter(Boolean))
  const unmerged = await paths(['diff', '--name-only', '--diff-filter=U', '-z'])
  const indexed = await paths(['ls-files', '-z'])
  return (path: string): ConflictSnapshot['conflicts'][number]['state'] =>
    unmerged.has(path) ? 'unresolved' : indexed.has(path) ? 'resolved' : 'deleted'
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
interface Operations {
  directory: string
  pull: PullRequest
  conflicts: string[]
  merge: MergeContext
  signal: AbortSignal
  needsUpdate: boolean
  verify: (headSha?: string) => Promise<void>
  allowed: Set<string>
  task: GandalfTask
  tracked: Set<string>
  choices: ReturnType<typeof createConflictChoices>
  git: (args: string[]) => Promise<string>
  publish: () => Promise<string>
}

function workspaceOperations(options: Operations): ConflictWorkspace {
  const { directory, pull, conflicts, allowed } = options
  const operations: ConflictWorkspace = {
    directory,
    pull,
    conflicts,
    merge: options.merge,
    needsUpdate: options.needsUpdate,
    verify: options.verify,
    inspect: () => snapshot(options),
    async apply(requestedEdits, requestedSelections = []) {
      // Deleting a regular conflict file through a selection means the same as a deletion edit.
      const deletions = requestedSelections.filter(
        (selection) => selection.side === 'delete' && allowed.has(selection.path),
      )
      const edits = [
        ...requestedEdits,
        ...deletions.map((selection) => ({ path: selection.path, content: null })),
      ]
      const selections = requestedSelections.filter((selection) => !deletions.includes(selection))
      const paths = [...edits, ...selections].map((change) => change.path)
      if (new Set(paths).size !== paths.length)
        return { changedPaths: [], problems: ['The turn changed the same file more than once.'] }
      const changedPaths: string[] = []
      const problems: string[] = []
      const attempt = async (path: string, step: () => Promise<void>) => {
        try {
          await step()
          changedPaths.push(path)
        } catch (error) {
          if (!(error instanceof UserError)) throw error
          problems.push(error.message)
        }
      }
      for (const edit of edits) await attempt(edit.path, () => applyEdit(options, edit))
      for (const selection of selections)
        await attempt(selection.path, () => options.choices.apply([selection]))
      problems.push(...(await leftovers(options)))
      return { changedPaths, problems }
    },
    async absorb(copy, reply) {
      const harvested = await changesInCopy(directory, copy, options.signal)
      const edits = [...harvested.edits, ...reply.edits]
      if (edits.length > MAX_GANDALF_CHANGED_FILES)
        return {
          changedPaths: [],
          problems: [
            `The working directory changed ${String(edits.length)} files, more than the ${String(MAX_GANDALF_CHANGED_FILES)} a resolution may change. Undo every change that is not part of the resolution.`,
          ],
        }
      const applied = await operations.apply(edits, reply.selections)
      return { ...applied, problems: [...harvested.problems, ...applied.problems] }
    },
    publish: options.publish,
    close: async () => {
      await rm(directory, { recursive: true, force: true })
      await rm(viewsDirectory(directory), { recursive: true, force: true })
    },
  }
  return operations
}

async function applyEdit(options: Operations, edit: FileEdit) {
  const { directory, allowed, git } = options
  if (options.task === 'ci') await admitCiEdit(directory, edit, allowed, options.tracked)
  const target = safePath(directory, edit.path, allowed)
  await textFile(directory, edit.path, allowed)
  if (
    edit.content !== null &&
    (Buffer.byteLength(edit.content) > MAX_FILE_BYTES ||
      edit.content.includes('\0') ||
      CONFLICT_MARKER.test(edit.content))
  )
    throw new UserError(`The resolution has invalid content or conflict markers: ${edit.path}.`)
  if (edit.content === null) {
    await rm(target, { force: true })
    // An earlier turn may already have deleted it; that is still the requested result.
    await git(['rm', '--cached', '--ignore-unmatch', '--quiet', '--', edit.path])
  } else {
    await writeFile(target, edit.content)
    await git(['add', '--all', '--', edit.path])
  }
}

/** Conflicts Git still records, and resolved conflict files that kept a marker. */
async function leftovers({ directory, conflicts, allowed, git }: Operations) {
  const problems: string[] = []
  const unresolved = (await git(['diff', '--name-only', '--diff-filter=U', '-z']))
    .split('\0')
    .filter(Boolean)
  if (unresolved.length)
    problems.push(
      `These merge conflicts are still unresolved: ${unresolved.join(', ')}. Edit each file in place to remove every conflict marker, keeping both the PR intent and the base behavior.`,
    )
  for (const path of conflicts) {
    if (unresolved.includes(path) || !allowed.has(path)) continue
    const content = await currentText(directory, path)
    if (content !== null && CONFLICT_MARKER.test(content))
      problems.push(`Conflict markers remain in ${path}.`)
  }
  return problems
}

async function snapshot({
  directory,
  pull,
  conflicts,
  allowed,
  git,
  choices: fileTypeChoices,
}: Operations): Promise<ConflictSnapshot> {
  const diff = await git(['diff', '--no-ext-diff', '--no-textconv', pull.headSha, '--'])
  const state = await conflictStates(git)
  const files = await Promise.all(
    conflicts.map(async (path) => {
      if (allowed.has(path))
        return { path, content: await textFile(directory, path, allowed), state: state(path) }
      const { choices } = await fileTypeChoices.inspect(path)
      return { path, content: '', choices, state: state(path) }
    }),
  )
  const revision = createHash('sha256')
    .update(JSON.stringify({ diff, conflicts: files }))
    .digest('hex')
  return {
    revision,
    conflicts: files.map(({ content: _content, ...conflict }) => conflict),
  }
}
