import { copyFile, lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GandalfTurn } from '../../shared/domain/gandalf'
import { MAX_FILE_BYTES } from '../limits'
import { hardenedGit } from './git'
import { INSPECTION_EXCLUDED_PATHS } from './inspectionCopy'
import { OVERFLOW_DIRECTORY } from './t3Engine/structuredOutput'
import { workspacePath } from './workspacePath'

type FileEdit = GandalfTurn['edits'][number]

/** A line Git writes to mark a conflict, including the zdiff3 ancestor section. */
export const CONFLICT_MARKER = /^([<]{7}|[|]{7}|[=]{7}|[>]{7})( |$)/m

/** Unmerged index states as `git status --porcelain` reports them. */
const UNMERGED = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

/**
 * The files the agent changed in `copy`, a copy of `directory`, as edits against the merge.
 * Git compares the copy's files against a scratch copy of this repository's index, so the copy's
 * own Git metadata, which the agent could have changed, is never read. Folders the copy leaves
 * out for agents, and files the runner adds there, are not the agent's changes.
 */
export async function changesInCopy(directory: string, copy: string, signal: AbortSignal) {
  const scratch = await mkdtemp(join(tmpdir(), 'gandalf-index-'))
  try {
    const index = join(scratch, 'index')
    await copyFile(join(directory, '.git', 'index'), index)
    const status = await hardenedGit(
      directory,
      [
        '--work-tree',
        copy,
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--no-renames',
        '--ignore-submodules=all',
      ],
      { signal, indexFile: index },
    )
    const edits: FileEdit[] = []
    const problems: string[] = []
    for (const entry of status.split('\0').filter(Boolean)) {
      const code = entry.slice(0, 2)
      const path = entry.slice(3)
      if (code[1] === ' ' && !UNMERGED.has(code)) continue
      if (runnerPath(path)) continue
      const copied = await copiedText(copy, path)
      if (typeof copied === 'object' && copied !== null) {
        problems.push(copied.problem)
        continue
      }
      if (copied === (await currentText(directory, path))) continue
      edits.push({ path, content: copied })
    }
    return { edits, problems }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function runnerPath(path: string) {
  const top = path.split('/')[0] ?? ''
  return (
    top === OVERFLOW_DIRECTORY || (INSPECTION_EXCLUDED_PATHS as readonly string[]).includes(top)
  )
}

/** A regular file's text in the agent's copy; null when the agent deleted it. */
async function copiedText(
  copy: string,
  path: string,
): Promise<string | null | { problem: string }> {
  const target = workspacePath(copy, path)
  try {
    const info = await lstat(target)
    if (!info.isFile())
      return { problem: `Only regular files can change; ${path} is not one. Restore it.` }
    if (info.size > MAX_FILE_BYTES) return { problem: `${path} is too large to resolve here.` }
    return await readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

/** A file's text in the merge checkout; null when it does not exist. */
export async function currentText(directory: string, path: string): Promise<string | null> {
  try {
    const target = workspacePath(directory, path)
    if (!(await lstat(target)).isFile()) return null
    return await readFile(target, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}
