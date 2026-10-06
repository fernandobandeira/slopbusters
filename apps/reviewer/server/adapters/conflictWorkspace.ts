import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { PullRequest } from '../../shared/domain/types'
import type { GandalfTurn } from '../../shared/domain/gandalf'
import { repositoryQuery } from '../../shared/api/contract'
import { MAX_FILE_BYTES, MAX_GANDALF_PROMPT_BYTES } from '../limits'
import { UserError } from '../errors'
import type { GitHub } from './github'
import { hardenedGit } from './git'
import { workspacePath } from './workspacePath'

const metadataSchema = z.object({
  state: z.enum(['open', 'closed']),
  head: z.object({
    sha: z.string(),
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
  base: z.object({ sha: z.string() }),
})
export interface ConflictSnapshot {
  revision: string
  diff: string
  conflicts: { path: string; content: string }[]
}
export interface ConflictWorkspace {
  directory: string
  conflicts: string[]
  inspect: () => Promise<ConflictSnapshot>
  apply: (edits: GandalfTurn['edits']) => Promise<void>
  publish: () => Promise<string>
  close: () => Promise<void>
}
interface Options {
  dataDirectory: string
  pull: PullRequest
  github: GitHub
  signal: AbortSignal
  remoteUrl?: (repository: string) => string
}

/** A separate repository merges the base into the PR; only reviewed content is published. */
export async function openConflictWorkspace(options: Options): Promise<ConflictWorkspace> {
  const { pull, signal, github } = options
  const root = join(options.dataDirectory, 'conflict-workspaces')
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'gandalf-'))
  const git = (args: string[]) => hardenedGit(directory, args, { signal })
  const endpoint = `repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`
  try {
    const metadata = metadataSchema.parse(await github.rest(endpoint, { signal }))
    checkRevision(pull, metadata)
    if (!metadata.head.repo) throw new UserError('The PR source repository is no longer available.')
    const headRepository = repositoryQuery.parse({
      repository: metadata.head.repo.full_name,
    }).repository
    const remote =
      options.remoteUrl ?? ((repository: string) => `https://github.com/${repository}.git`)
    await git(['init', '--template=', '--initial-branch=gandalf'])
    await git(['check-ref-format', `refs/heads/${metadata.head.ref}`])
    await fetchCommit(git, remote(headRepository), pull.headSha)
    await fetchCommit(git, remote(`${pull.owner}/${pull.repo}`), pull.baseSha)
    await git(['checkout', '--quiet', '--detach', pull.headSha])
    const conflicts = await mergeBase(git, pull.baseSha)
    const allowed = await regularPaths(git)
    for (const path of conflicts)
      if (!allowed.has(path))
        throw new UserError(
          `Gandalf cannot automatically resolve a binary, symlink or submodule conflict: ${path}.`,
        )
    return workspaceOperations({
      directory,
      pull,
      conflicts,
      allowed,
      git,
      publish: async () => {
        // The push also has an atomic head lease; this check covers a changed base or closed PR.
        checkRevision(pull, metadataSchema.parse(await github.rest(endpoint, { signal })))
        const tree = (await git(['write-tree'])).trim()
        const sha = (
          await git([
            '-c',
            'user.name=Gandalf',
            '-c',
            'user.email=gandalf@slopbusters.local',
            'commit-tree',
            tree,
            '-p',
            pull.headSha,
            '-p',
            pull.baseSha,
            '-m',
            `Resolve merge conflicts for PR #${pull.number}`,
          ])
        ).trim()
        signal.throwIfAborted()
        await hardenedGit(directory, [
          '-c',
          'credential.helper=',
          '-c',
          'credential.helper=!gh auth git-credential',
          'push',
          '--porcelain',
          `--force-with-lease=refs/heads/${metadata.head.ref}:${pull.headSha}`,
          remote(headRepository),
          `${sha}:refs/heads/${metadata.head.ref}`,
        ])
        return sha
      },
    })
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

function checkRevision(pull: PullRequest, metadata: z.infer<typeof metadataSchema>) {
  if (
    metadata.state !== 'open' ||
    metadata.head.sha !== pull.headSha ||
    metadata.base.sha !== pull.baseSha
  )
    throw new UserError('This PR changed during conflict resolution. Refresh it and retry.')
}
async function fetchCommit(git: (args: string[]) => Promise<string>, remote: string, sha: string) {
  if (!/^[a-f\d]{40,64}$/.test(sha)) throw new UserError('Invalid PR revision.')
  await git([
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
  ])
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
async function regularPaths(git: (args: string[]) => Promise<string>) {
  const entries = (await git(['ls-files', '--stage', '-z'])).split('\0').filter(Boolean)
  const paths = new Set<string>()
  const unsupported = new Set<string>()
  for (const entry of entries) {
    const separator = entry.indexOf('\t')
    const metadata = entry.slice(0, separator)
    const path = entry.slice(separator + 1)
    if (!path) throw new Error('Invalid Git index entry.')
    if (/^100(644|755) /.test(metadata)) paths.add(path)
    else unsupported.add(path)
  }
  for (const path of unsupported) paths.delete(path)
  return paths
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
  allowed: Set<string>
  git: (args: string[]) => Promise<string>
  publish: () => Promise<string>
}): ConflictWorkspace {
  const { directory, pull, conflicts, allowed, git } = options
  return {
    directory,
    conflicts,
    async inspect() {
      const diff = await git(['diff', '--no-ext-diff', '--no-textconv', pull.headSha, '--'])
      const files = await Promise.all(
        conflicts.map(async (path) => ({
          path,
          content: await textFile(directory, path, allowed),
        })),
      )
      const data = JSON.stringify({ diff, conflicts: files })
      if (Buffer.byteLength(data) > MAX_GANDALF_PROMPT_BYTES)
        throw new UserError('These conflicts exceed the automatic resolution size limit.')
      return { revision: createHash('sha256').update(data).digest('hex'), diff, conflicts: files }
    },
    async apply(edits) {
      if (new Set(edits.map((edit) => edit.path)).size !== edits.length)
        throw new UserError('The model returned duplicate file edits.')
      for (const edit of edits) {
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
      if ((await git(['ls-files', '--unmerged'])).trim())
        throw new UserError('The model left unresolved conflicts. Retry the resolution.')
      await git(['diff', '--cached', '--check'])
    },
    publish: options.publish,
    close: () => rm(directory, { recursive: true, force: true }),
  }
}
