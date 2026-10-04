import type { AnnotationSide, TokenEventBase } from '@pierre/diffs'

export interface CodeSymbol {
  line: number
  column: number
  text: string
}

/** Resolve the caret inside a syntax token, which may contain several identifiers. */
export function clickedSymbol(props: TokenEventBase, event: MouseEvent): CodeSymbol | undefined {
  const owner = props.tokenElement.ownerDocument
  const root = props.tokenElement.getRootNode()
  const caret = owner.caretPositionFromPoint?.(event.clientX, event.clientY, {
    shadowRoots: root instanceof ShadowRoot ? [root] : [],
  })
  let offset = 0
  if (caret && props.tokenElement.contains(caret.offsetNode)) {
    const range = owner.createRange()
    range.selectNodeContents(props.tokenElement)
    range.setEnd(caret.offsetNode, caret.offset)
    offset = range.toString().length
  }
  const identifiers = props.tokenText.matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)
  for (const match of identifiers) {
    if (offset >= match.index && offset <= match.index + match[0].length)
      return {
        line: props.lineNumber,
        column: props.lineCharStart + Math.min(offset, match.index + match[0].length - 1) + 1,
        text: match[0],
      }
  }
}

/** Pierre has token click callbacks, but context menus need its shadow DOM coordinates. */
export function contextMenuToken(
  event: MouseEvent,
): (TokenEventBase & { side: AnnotationSide }) | undefined {
  const path = event.composedPath()
  const token = path.find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('data-char'),
  )
  const line = token?.closest<HTMLElement>('[data-line]')
  const code = line?.closest('[data-code]')
  if (!token || !line || !code) return
  const lineNumber = Number(line.getAttribute('data-line'))
  const lineCharStart = Number(token.getAttribute('data-char'))
  if (
    !Number.isSafeInteger(lineNumber) ||
    lineNumber < 1 ||
    !Number.isSafeInteger(lineCharStart) ||
    lineCharStart < 0
  )
    return
  const lineType = line.getAttribute('data-line-type')
  const side =
    lineType === 'change-deletion' ||
    (lineType !== 'change-addition' && code.hasAttribute('data-deletions'))
      ? 'deletions'
      : 'additions'
  const tokenText = token.textContent ?? ''
  return {
    type: 'token',
    lineNumber,
    lineCharStart,
    lineCharEnd: lineCharStart + tokenText.length,
    tokenText,
    tokenElement: token,
    side,
  }
}
