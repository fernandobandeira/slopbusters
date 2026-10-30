import type { SplitUnit } from './split'

/** A unit with the patch text that applies it: its file's headers and its hunks. */
export interface PatchUnit extends SplitUnit {
  /** The `diff --git` block's header lines, up to the first hunk. */
  fileHeader: string
  /** The unit's own hunk, or the whole file's patch after the header for a file unit. */
  body: string
}

/**
 * Cut a `git diff --binary -M` of the PR into units a layer can take whole: one per hunk of a
 * modified text file, and one per file that was added, deleted, renamed, is binary, or changed
 * mode, since such a file's patch only applies as one.
 */
export function parseUnits(diff: string): PatchUnit[] {
  const units: PatchUnit[] = []
  for (const block of fileBlocks(diff)) {
    const { header, hunks, path, previousPath } = block
    const reason = wholeFileReason(header, hunks)
    if (reason) {
      units.push({
        id: `u${String(units.length + 1)}`,
        path,
        ...(previousPath ? { previousPath } : {}),
        kind: 'file',
        header: reason,
        ...count(hunks.join('')),
        fileHeader: header,
        body: hunks.join(''),
      })
      continue
    }
    for (const hunk of hunks)
      units.push({
        id: `u${String(units.length + 1)}`,
        path,
        kind: 'hunk',
        header: hunk.slice(0, hunk.indexOf('\n')),
        ...count(hunk),
        fileHeader: header,
        body: hunk,
      })
  }
  return units
}

/** The patch that applies these units of one file, in the order they appear in the PR's diff. */
export function filePatch(units: readonly PatchUnit[]): string {
  const [first] = units
  if (!first) return ''
  return first.fileHeader + units.map((unit) => unit.body).join('')
}

/** Units grouped by the file they change, each group in diff order. */
export function byFile(units: readonly PatchUnit[]): PatchUnit[][] {
  const groups = new Map<string, PatchUnit[]>()
  for (const unit of units)
    groups.set(unit.fileHeader, [...(groups.get(unit.fileHeader) ?? []), unit])
  return [...groups.values()]
}

interface FileBlock {
  header: string
  hunks: string[]
  path: string
  previousPath?: string
}

function fileBlocks(diff: string): FileBlock[] {
  const blocks: FileBlock[] = []
  const lines = diff.split('\n')
  if (lines.at(-1) === '') lines.pop()
  let current: { headerLines: string[]; hunkLines: string[][] } | undefined
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) blocks.push(toBlock(current))
      current = { headerLines: [line], hunkLines: [] }
      continue
    }
    if (!current) continue
    if (line.startsWith('@@')) current.hunkLines.push([line])
    else if (current.hunkLines.length) current.hunkLines.at(-1)?.push(line)
    else current.headerLines.push(line)
  }
  if (current) blocks.push(toBlock(current))
  return blocks
}

function toBlock(block: { headerLines: string[]; hunkLines: string[][] }): FileBlock {
  const header = block.headerLines.join('\n') + '\n'
  const hunks = block.hunkLines.map((hunk) => hunk.join('\n') + '\n')
  return { header, hunks, ...parseNames(block.headerLines) }
}

/** The file's path after the change, and before it when renamed. */
function parseNames(headerLines: string[]): { path: string; previousPath?: string } {
  const from = headerLines.find((line) => line.startsWith('rename from '))?.slice(12)
  const to = headerLines.find((line) => line.startsWith('rename to '))?.slice(10)
  if (from && to) return { path: to, previousPath: from }
  const plus = headerLines.find((line) => line.startsWith('+++ '))?.slice(4)
  const minus = headerLines.find((line) => line.startsWith('--- '))?.slice(4)
  const named = plus && plus !== '/dev/null' ? plus : minus
  if (named && named !== '/dev/null') return { path: named.replace(/^[ab]\//, '') }
  const match = /^diff --git a\/(.*) b\/(.*)$/.exec(headerLines[0] ?? '')
  return { path: match?.[2] ?? headerLines[0] ?? '' }
}

/** Why a file's patch is one unit, or undefined when its hunks can go to different layers. */
function wholeFileReason(header: string, hunks: string[]): string | undefined {
  if (/^rename from /m.test(header)) return 'renamed'
  if (/^new file mode /m.test(header)) return 'added'
  if (/^deleted file mode /m.test(header)) return 'deleted'
  if (/^(GIT binary patch|Binary files )/m.test(header)) return 'binary'
  if (/^old mode /m.test(header)) return 'mode'
  return hunks.length ? undefined : 'changed'
}

function count(patch: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}
