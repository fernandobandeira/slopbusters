import type { PullFileContent, RevisionFileContent } from '../../../shared/domain/fileContent'
import { TransferKind, type CodeTransfer, type PullRequest } from '../../../shared/domain/types'
import { enclosingSymbol } from './diff/separatorSymbols'

const CONTEXT = 4

export interface TransferLine {
  number: number
  text: string
  transferred: boolean
}

/** One end of a moved or copied block, read in the revision it lives in. */
export interface TransferEnd {
  path: string
  line: number
  symbol?: string
  lines: TransferLine[]
}

export interface TransferView {
  from: TransferEnd
  to: TransferEnd
  /**
   * Moved code now sits in a different function or class, where its logic may no longer hold.
   * Copies always land somewhere new and keep their original, so they are not flagged.
   */
  changedSymbol: boolean
}

/** Where a block came from and where it went, each with the code around it. */
export function transferView(
  pull: PullRequest,
  transfer: CodeTransfer,
  contents: ReadonlyMap<string, PullFileContent>,
): TransferView {
  const content = (path: string) =>
    contents.get(pull.files.find((file) => file.path === path)?.id ?? '')
  const from = transferEnd(
    transfer.fromPath,
    transfer.fromLine,
    transfer.lineCount,
    content(transfer.fromPath)?.old,
  )
  const to = transferEnd(
    transfer.toPath,
    transfer.toLine,
    transfer.lineCount,
    content(transfer.toPath)?.new,
  )
  const known = from.lines.length > 0 && to.lines.length > 0
  const moved = transfer.kind === TransferKind.moved
  return { from, to, changedSymbol: moved && known && from.symbol !== to.symbol }
}

function transferEnd(
  path: string,
  line: number,
  count: number,
  revision?: RevisionFileContent | null,
): TransferEnd {
  if (!revision) return { path, line, lines: [] }
  const source = revision.content.split('\n')
  const first = Math.max(1, line - CONTEXT)
  const last = Math.min(source.length, line + count - 1 + CONTEXT)
  const lines = []
  for (let number = first; number <= last; number++)
    lines.push({
      number,
      text: source[number - 1]?.replace(/\r$/, '') ?? '',
      transferred: number >= line && number < line + count,
    })
  const symbol = enclosingSymbol(revision.symbols, line)
  return { path, line, ...(symbol ? { symbol } : {}), lines }
}
