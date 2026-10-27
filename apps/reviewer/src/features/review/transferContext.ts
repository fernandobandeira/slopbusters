import type { PullFileContent } from '../../../shared/domain/fileContent'
import {
  DiffSide,
  TransferKind,
  type ChangedFile,
  type CodeTransfer,
  type PullRequest,
} from '../../../shared/domain/types'
import { enclosingSymbol } from './diff/separatorSymbols'

export interface TransferView {
  /** The function or class around the block where it came from, in the base. */
  fromSymbol?: string
  /** The function or class around the block where it landed, in the head. */
  toSymbol?: string
  /**
   * Moved code now sits in a different function or class, where its logic may no longer hold.
   * Copies always land somewhere new and keep their original, so they are not flagged.
   */
  changedSymbol: boolean
}

/** The code around both ends of a moved or copied block, read in the revision each lives in. */
export function transferView(
  pull: PullRequest,
  transfer: CodeTransfer,
  contents: ReadonlyMap<string, PullFileContent>,
): TransferView {
  const from = contents.get(transferFile(pull, transfer, DiffSide.left)?.id ?? '')?.old
  const to = contents.get(transferFile(pull, transfer, DiffSide.right)?.id ?? '')?.new
  const fromSymbol = from ? enclosingSymbol(from.symbols, transfer.fromLine) : undefined
  const toSymbol = to ? enclosingSymbol(to.symbols, transfer.toLine) : undefined
  const moved = transfer.kind === TransferKind.moved
  return {
    ...(fromSymbol ? { fromSymbol } : {}),
    ...(toSymbol ? { toSymbol } : {}),
    changedSymbol: moved && Boolean(from && to) && fromSymbol !== toSymbol,
  }
}

/** The PR file holding one end of a block: its source in the base or destination in the head. */
export function transferFile(
  pull: PullRequest,
  transfer: CodeTransfer,
  side: DiffSide,
): ChangedFile | undefined {
  const path = side === DiffSide.left ? transfer.fromPath : transfer.toPath
  const revisionPath = (file: ChangedFile) =>
    side === DiffSide.left ? (file.previousPath ?? file.path) : file.path
  return (
    pull.files.find((file) => revisionPath(file) === path) ??
    pull.files.find((file) => file.path === path)
  )
}

/** e.g. `12–18`, or `12` for a single line. */
export function lineRange(first: number, last: number) {
  return first === last ? String(first) : `${String(first)}–${String(last)}`
}
