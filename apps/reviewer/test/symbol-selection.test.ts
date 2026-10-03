import { describe, expect, it } from 'vitest'
import { identifierAtOffset } from '../src/symbolSelection'

describe('symbol selection in highlighted source', () => {
  it('selects the clicked identifier within a token containing several symbols', () => {
    const text = 'const result = service.run(value)'
    expect(identifierAtOffset(text, text.indexOf('result') + 3)).toEqual({
      text: 'result',
      column: 7,
    })
    expect(identifierAtOffset(text, text.indexOf('run') + 1)).toEqual({ text: 'run', column: 24 })
    expect(identifierAtOffset(text, text.indexOf('value') + 2)).toEqual({
      text: 'value',
      column: 28,
    })
  })
  it('preserves UTF-16 columns for Unicode identifiers and emoji before a symbol', () => {
    const text = "const emoji = '😀'; const preço = $store"
    expect(identifierAtOffset(text, text.indexOf('preço') + 2)).toEqual({
      text: 'preço',
      column: 27,
    })
    expect(identifierAtOffset(text, text.indexOf('$store') + 2)).toEqual({
      text: '$store',
      column: 35,
    })
  })
  it('does not navigate whitespace, punctuation, keywords, or numeric literals', () => {
    const text = 'const value = 123; value()'
    for (const offset of [0, 5, 12, 14, 16, 18, 24, 25])
      expect(identifierAtOffset(text, offset)).toBeUndefined()
    expect(identifierAtOffset('value', 5)).toEqual({ text: 'value', column: 1 })
  })
})
