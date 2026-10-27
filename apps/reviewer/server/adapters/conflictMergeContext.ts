import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PullRequest } from '../../shared/domain/types'
import { MAX_FILE_BYTES, MAX_GANDALF_CONFLICT_COMMITS } from '../limits'
import { OVERFLOW_DIRECTORY } from './t3Engine/structuredOutput'
import { workspacePath } from './workspacePath'

/** What the merge brings together for the conflicted files, for the agents to study. */
export interface MergeContext {
  /** Commits that touched the conflicted files since the merge base, newest first. */
  commits: { pull: string[]; base: string[] }
  /**
   * A folder holding, for each conflicted regular file at `<path>/`, its `ancestor`, `pull` and
   * `base` versions where they exist, and `pull.diff` and `base.diff` from the merge base.
   */
  views?: string
}
/** Where the merge views appear in an agent's copy; the runner's folder is never harvested. */
export const MERGE_VIEWS_PATH = `${OVERFLOW_DIRECTORY}/merge`

/** Beside the checkout, so nothing in it reaches the merge or the agent's changes. */
export function viewsDirectory(directory: string) {
  return `${directory}-merge`
}

/**
 * The commits on each side that touched the conflicted files, and the versions of each regular
 * conflicted file, read from the commits so they do not depend on the index as turns resolve it.
 */
export async function mergeContext(
  git: (args: string[]) => Promise<string>,
  directory: string,
  pull: PullRequest,
  conflicts: string[],
): Promise<MergeContext> {
  if (!conflicts.length) return { commits: { pull: [], base: [] } }
  const base = (await git(['merge-base', pull.headSha, pull.baseSha])).trim()
  const log = async (tip: string) =>
    (
      await git([
        'log',
        '--no-merges',
        `--max-count=${String(MAX_GANDALF_CONFLICT_COMMITS)}`,
        '--format=%h %an: %s',
        `${base}..${tip}`,
        '--',
        ...conflicts,
      ])
    )
      .split('\n')
      .filter(Boolean)
  const views = viewsDirectory(directory)
  const sides = [
    ['ancestor', base],
    ['pull', pull.headSha],
    ['base', pull.baseSha],
  ] as const
  for (const path of conflicts) {
    const folder = workspacePath(views, path)
    await mkdir(folder, { recursive: true })
    for (const [name, sha] of sides) {
      const content = await blobText(git, sha, path)
      if (content !== null) await writeFile(join(folder, name), content)
    }
    for (const [name, sha] of sides.slice(1)) {
      const diff = await git(['diff', '--no-ext-diff', '--no-textconv', base, sha, '--', path])
      if (Buffer.byteLength(diff) <= MAX_FILE_BYTES)
        await writeFile(join(folder, `${name}.diff`), diff)
    }
  }
  return { commits: { pull: await log(pull.headSha), base: await log(pull.baseSha) }, views }
}

/** A regular file's text at a commit; null when it is absent, not a file, binary or too large. */
async function blobText(git: (args: string[]) => Promise<string>, sha: string, path: string) {
  const entry = await git(['ls-tree', '-z', sha, '--', path])
  const match = /^(100644|100755) blob ([a-f\d]{40,64})\t/.exec(entry)
  if (!match?.[2]) return null
  const size = Number((await git(['cat-file', '-s', match[2]])).trim())
  if (!Number.isSafeInteger(size) || size > MAX_FILE_BYTES) return null
  const content = await git(['cat-file', 'blob', match[2]])
  return content.includes('\0') ? null : content
}
