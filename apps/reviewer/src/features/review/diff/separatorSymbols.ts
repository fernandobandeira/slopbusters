import type { PullFileContent } from '../../../../shared/domain/fileContent'
import type { SourceSymbol } from '../../../../shared/domain/sourceSymbols'

/** The function or class a line sits in, outermost first, e.g. `BalanceCardService.topUpFboToCredit`. */
export function enclosingSymbol(symbols: readonly SourceSymbol[], line: number) {
  const chain = symbols
    .filter((symbol) => symbol.line <= line && line <= symbol.endLine)
    .sort((left, right) => right.endLine - right.line - (left.endLine - left.line))
  // Methods may already be qualified (`Service.method`); drop a parent the child repeats.
  const names = chain
    .map((symbol) => symbol.name)
    .filter((name, index, all) => !all[index + 1]?.startsWith(`${name}.`))
  return names.length ? names.join(' › ') : undefined
}

/**
 * Hunk separators only say how many lines they hide, which leaves a section that starts inside a
 * function without its name. Label each separator with the symbol enclosing the code after it.
 * Pierre re-renders rows on scroll, so this runs after every render and is idempotent.
 */
export function labelSeparators(root: ShadowRoot, content: PullFileContent) {
  for (const separator of root.querySelectorAll('[data-content] > [data-separator]')) {
    // Split view repeats each separator per column; label the new side only.
    if (separator.closest('[data-code]')?.hasAttribute('data-deletions')) continue
    const text = separator.querySelector('[data-separator-content]')
    if (!text) continue
    const label = followingSymbol(separator, content)
    let span = text.querySelector('[data-enclosing-symbol]')
    if (!label) {
      span?.remove()
      continue
    }
    if (!span) {
      span = document.createElement('span')
      span.setAttribute('data-enclosing-symbol', '')
      text.append(span)
    }
    if (span.textContent !== label) span.textContent = label
  }
}

function followingSymbol(separator: Element, content: PullFileContent) {
  for (let row = separator.nextElementSibling; row; row = row.nextElementSibling) {
    if (row.hasAttribute('data-separator')) return undefined
    const line = Number(row.getAttribute('data-line'))
    if (!line) continue
    const old = row.getAttribute('data-line-type')?.includes('deletion')
    const revision = old ? content.old : content.new
    return revision ? enclosingSymbol(revision.symbols, line) : undefined
  }
  return undefined
}
