import ts from 'typescript'

/** Unknown means resolving imports or another language provider would be required. */
export function symbolImplementationSupport(
  path: string,
  content: string,
  line: number,
  column: number,
): boolean | null {
  if (!/\.[cm]?[jt]sx?$/i.test(path) || content.length > 500_000) return null
  const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true)
  const start = source.getLineStarts()[line - 1]
  const text = content.split('\n')[line - 1]?.replace(/\r$/, '')
  if (start === undefined || !text || column < 1 || column > text.length) return null
  const position = start + column - 1
  let identifier: ts.Identifier | undefined
  function find(node: ts.Node) {
    if (position < node.getStart(source) || position >= node.end) return
    if (ts.isIdentifier(node)) identifier = node
    else ts.forEachChild(node, find)
  }
  find(source)
  if (!identifier) return null
  const program = ts.createProgram(
    [path],
    { noLib: true, noResolve: true, allowJs: true },
    {
      getSourceFile: (name) => (name === path ? source : undefined),
      getDefaultLibFileName: () => '',
      writeFile: () => {},
      getCurrentDirectory: () => '',
      getDirectories: () => [],
      fileExists: (name) => name === path,
      readFile: (name) => (name === path ? content : undefined),
      getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
    },
  )
  const checker = program.getTypeChecker()
  const symbol = checker.getSymbolAtLocation(identifier)
  if (!symbol || symbol.flags & ts.SymbolFlags.Alias) return null
  if (symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.Class | ts.SymbolFlags.Method))
    return true
  if (symbol.flags & ts.SymbolFlags.Property)
    return (
      symbol.declarations?.some(
        (node) => ts.isPropertySignature(node) || ts.isPropertyDeclaration(node),
      ) ?? null
    )
  if (symbol.flags & ts.SymbolFlags.TypeAlias)
    return implementableType(checker.getDeclaredTypeOfSymbol(symbol))
  return false
}

function implementableType(type: ts.Type): boolean | null {
  if (type.isUnion()) return false
  if (type.isIntersection()) {
    const parts = type.types.map(implementableType)
    return parts.includes(false) ? false : parts.includes(null) ? null : true
  }
  if (type.flags & ts.TypeFlags.Object) return true
  if (
    type.flags &
    (ts.TypeFlags.Any |
      ts.TypeFlags.Unknown |
      ts.TypeFlags.TypeParameter |
      ts.TypeFlags.Conditional)
  )
    return null
  return false
}
