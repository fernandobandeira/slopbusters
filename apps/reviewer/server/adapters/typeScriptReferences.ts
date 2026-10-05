import type ts from 'typescript'

/** Resolve import aliases too, without repeating searches for declarations already covered. */
export function findTypeScriptReferences(
  service: ts.LanguageService,
  fileName: string,
  position: number,
  definitions: readonly ts.DefinitionInfo[],
): ts.ReferenceEntry[] {
  const groups = service.findReferences(fileName, position) ?? []
  const searched = new Set(groups.map((group) => definitionKey(group.definition)))
  for (const definition of definitions) {
    const key = definitionKey(definition)
    if (searched.has(key)) continue
    searched.add(key)
    const extra = service.findReferences(definition.fileName, definition.textSpan.start) ?? []
    for (const group of extra) searched.add(definitionKey(group.definition))
    groups.push(...extra)
  }
  return groups.flatMap((group) => group.references)
}

function definitionKey(definition: Pick<ts.DefinitionInfo, 'fileName' | 'textSpan'>) {
  return JSON.stringify([
    definition.fileName,
    definition.textSpan.start,
    definition.textSpan.length,
  ])
}
