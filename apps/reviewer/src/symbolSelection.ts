import type { TokenEventBase } from '@pierre/diffs'
import type { NavigationRequest } from '../shared/navigation'
import { DiffSide } from '../shared/types'

export interface SymbolSelection extends Omit<NavigationRequest, 'kind'> {
  text: string
  fileId?: string
}
export interface SymbolOrigin {
  path: string
  previousPath?: string
  fileId?: string
  side?: DiffSide
}

const keywords = new Set(
  'const let var function class interface type return if else for while switch case break continue import export from default new this super extends implements async await true false null undefined void typeof instanceof throw try catch finally'.split(
    ' ',
  ),
)

/** Offsets and columns stay in UTF-16, like the TypeScript language service. */
export function identifierAtOffset(text: string, offset: number) {
  for (const match of text.matchAll(/[\p{ID_Start}_$][\p{ID_Continue}$\u200c\u200d]*/gu)) {
    const start = match.index
    const end = start + match[0].length
    if (offset >= start && (offset < end || (offset === end && end === text.length))) {
      if (keywords.has(match[0])) return undefined
      return { text: match[0], column: start + 1 }
    }
  }
  return undefined
}

function tokenOffset(token: HTMLElement, event: MouseEvent): number | undefined {
  const owner = token.ownerDocument
  const root = token.getRootNode()
  const caret = owner.caretPositionFromPoint?.(event.clientX, event.clientY, {
    shadowRoots: root instanceof ShadowRoot ? [root] : [],
  })
  if (caret && token.contains(caret.offsetNode)) {
    const range = owner.createRange()
    range.selectNodeContents(token)
    range.setEnd(caret.offsetNode, caret.offset)
    return range.toString().length
  }
  // Keyboard context menus and browsers without shadow-root caret support can still
  // navigate an isolated identifier. Never guess within a multi-symbol token.
  const text = token.textContent ?? ''
  const identifier = identifierAtOffset(text, text.search(/\S/))
  if (identifier && text.trim() === identifier.text) return identifier.column - 1
  return undefined
}

export function clickedSymbol(props: TokenEventBase, event: MouseEvent) {
  const offset = tokenOffset(props.tokenElement, event)
  const line = props.tokenElement.closest<HTMLElement>('[data-line]')
  if (offset == null || !line) return undefined
  const identifier = identifierAtOffset(line.textContent ?? '', props.lineCharStart + offset)
  return identifier ? { ...identifier, line: props.lineNumber } : undefined
}

export function contextSymbol(
  event: MouseEvent,
  origin: SymbolOrigin,
): SymbolSelection | undefined {
  const path = event.composedPath()
  const token = path.find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement && element.hasAttribute('data-char'),
  )
  const row = token?.closest<HTMLElement>('[data-line]')
  if (!token || !row) return undefined
  const line = Number(row.dataset.line)
  const start = Number(token.dataset.char)
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(start)) return undefined
  const selection = clickedSymbol(
    {
      type: 'token',
      tokenElement: token,
      tokenText: token.textContent ?? '',
      lineNumber: line,
      lineCharStart: start,
      lineCharEnd: start + (token.textContent?.length ?? 0),
    },
    event,
  )
  if (!selection) return undefined
  const side =
    origin.side ??
    (row.dataset.lineType === 'change-deletion' ||
    (row.dataset.lineType !== 'change-addition' &&
      row.closest('[data-code]')?.hasAttribute('data-deletions'))
      ? DiffSide.left
      : DiffSide.right)
  return {
    ...selection,
    side,
    path: side === DiffSide.left ? (origin.previousPath ?? origin.path) : origin.path,
    fileId: origin.fileId,
  }
}
