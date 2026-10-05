import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { findTypeScriptReferences } from '../server/adapters/typeScriptReferences'

function definition(fileName: string, start: number): ts.DefinitionInfo {
  return {
    fileName,
    textSpan: { start, length: 7 },
    kind: ts.ScriptElementKind.interfaceElement,
    name: 'Account',
    containerKind: ts.ScriptElementKind.unknown,
    containerName: '',
  }
}

describe('TypeScript reference searches', () => {
  it('searches a resolved declaration only once while preserving an additional import-alias lookup', () => {
    const local = definition('consumer.ts', 8)
    const resolved = definition('types.ts', 10)
    const references: ts.ReferenceEntry[] = [
      { fileName: 'consumer.ts', textSpan: { start: 28, length: 7 }, isWriteAccess: false },
    ]
    const findReferences = vi.fn(() => [{ definition: resolved, references }])
    const service = { findReferences } as unknown as ts.LanguageService

    expect(findTypeScriptReferences(service, 'consumer.ts', 30, [resolved])).toEqual(references)
    expect(findReferences).toHaveBeenCalledTimes(1)

    findReferences.mockClear()
    findReferences.mockReturnValueOnce([{ definition: local, references: [] }])
    expect(findTypeScriptReferences(service, 'consumer.ts', 30, [resolved, resolved])).toEqual(
      references,
    )
    expect(findReferences.mock.calls).toEqual([
      ['consumer.ts', 30],
      ['types.ts', 10],
    ])
  })
})
