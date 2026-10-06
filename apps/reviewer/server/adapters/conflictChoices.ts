import { chmod, lstat, rm, writeFile } from 'node:fs/promises'
import type { GandalfTurn } from '../../shared/domain/gandalf'
import type { IndexEntry } from './conflictIndex'
import { workspacePath } from './workspacePath'
import { UserError } from '../errors'
import { MAX_FILE_BYTES } from '../limits'

type Git = (args: string[]) => Promise<string>

/** Resolve file/symlink conflicts using existing blobs; never create or follow filesystem symlinks. */
export function createConflictChoices(
  directory: string,
  git: Git,
  entries: Map<string, IndexEntry[]>,
  revisions: { headSha: string; baseSha: string },
) {
  async function content(entry: IndexEntry) {
    const size = Number((await git(['cat-file', '-s', entry.sha])).trim())
    if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES)
      throw new UserError(`Cannot resolve this file automatically: ${entry.path}.`)
    return git(['cat-file', 'blob', entry.sha])
  }
  async function candidates(path: string) {
    const stages = entries.get(path)
    if (!stages) return []
    const result = stages.filter((entry) => ['2', '3'].includes(entry.stage))
    // Git relocates the regular file to ~HEAD for a file/symlink conflict.
    // Recover the original side from its immutable tree, rather than treating it as deleted.
    for (const [stage, sha] of [
      ['2', revisions.headSha],
      ['3', revisions.baseSha],
    ] as const) {
      if (result.some((entry) => entry.stage === stage)) continue
      const output = await git(['ls-tree', '-z', sha, '--', path])
      const match = /^(100644|100755|120000) blob ([a-f\d]{40,64})\t([^\0]+)\0$/.exec(output)
      if (match?.[1] && match[2] && match[3] === path)
        result.push({ mode: match[1], sha: match[2], path, stage: stage })
    }
    return result
  }
  return {
    async inspect(path: string) {
      const choices = []
      for (const entry of await candidates(path)) {
        choices.push({
          side: entry.stage === '2' ? ('head' as const) : ('base' as const),
          type: entry.mode === '120000' ? ('symlink' as const) : ('file' as const),
          content: await content(entry),
        })
      }
      return { path, content: '', choices }
    },
    async apply(selections: GandalfTurn['selections']) {
      if (new Set(selections.map((selection) => selection.path)).size !== selections.length)
        throw new UserError('The model returned duplicate file-type selections.')
      for (const selection of selections) {
        const available = await candidates(selection.path)
        if (
          !entries.has(selection.path) ||
          selection.path.split('/').some((part) => ['.git', '.', '..'].includes(part.toLowerCase()))
        )
          throw new UserError(`Unsupported file-type selection: ${selection.path}.`)
        const target = workspacePath(directory, selection.path)
        await requireRegularLocation(target, selection.path)
        if (selection.side === 'delete') {
          await rm(target, { force: true })
          await git(['update-index', '--force-remove', '--', selection.path])
          continue
        }
        const entry = available.find(
          (candidate) => candidate.stage === (selection.side === 'head' ? '2' : '3'),
        )
        if (!entry || !['100644', '100755', '120000'].includes(entry.mode))
          throw new UserError(`The selected side is unavailable: ${selection.path}.`)
        await writeFile(target, await content(entry))
        await chmod(target, entry.mode === '100755' ? 0o755 : 0o644)
        await git([
          'update-index',
          '--add',
          '--cacheinfo',
          `${entry.mode},${entry.sha},${selection.path}`,
        ])
      }
    },
  }
}

async function requireRegularLocation(target: string, path: string) {
  try {
    if (!(await lstat(target)).isFile())
      throw new UserError(`Cannot replace a directory or filesystem symlink: ${path}.`)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}
