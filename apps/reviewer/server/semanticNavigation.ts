import { posix } from 'node:path'
import ts from 'typescript'
import type { NavigationTarget } from '../shared/navigation'

interface SemanticRequest {
  path: string
  line: number
  column: number
  kind: 'definition' | 'references'
}

const root = '/review'
function virtualName(path: string): string | undefined {
  const normalized = posix.resolve(root, path)
  return normalized.startsWith(`${root}/`) ? normalized : undefined
}

/** Resolve symbols using only fetched revision text, with no host filesystem or project execution. */
export function navigateTypeScript(
  files: Map<string, string>,
  request: SemanticRequest,
  options: ts.CompilerOptions = {},
): NavigationTarget[] {
  const snapshots = new Map<string, ts.IScriptSnapshot>()
  const text = new Map<string, string>()
  const directories = new Set<string>([root])
  for (const [path, content] of files) {
    const name = virtualName(path)
    if (!name) continue
    text.set(name, content)
    snapshots.set(name, ts.ScriptSnapshot.fromString(content))
    let directory = posix.dirname(name)
    while (directory.startsWith(root)) {
      directories.add(directory)
      if (directory === root) break
      directory = posix.dirname(directory)
    }
  }
  const fileName = virtualName(request.path)
  if (
    !fileName ||
    !text.has(fileName) ||
    !Number.isSafeInteger(request.line) ||
    !Number.isSafeInteger(request.column) ||
    request.line < 1 ||
    request.column < 1
  )
    return []

  const settings: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    ...options,
    baseUrl: options.baseUrl
      ? posix.resolve(root, options.baseUrl) === root
        ? root
        : virtualName(options.baseUrl)
      : undefined,
    // Repository compiler configuration may affect aliases, but cannot load host libraries/plugins.
    noLib: true,
    noEmit: true,
    allowJs: true,
    types: [],
    typeRoots: [],
    plugins: [],
  }
  const readFile = (path: string) => {
    const name = virtualName(path)
    return name ? text.get(name) : undefined
  }
  const fileExists = (path: string) => {
    const name = virtualName(path)
    return name != null && text.has(name)
  }
  const directoryExists = (path: string) => directories.has(posix.resolve(root, path))
  const resolutionHost: ts.ModuleResolutionHost = {
    readFile,
    fileExists,
    directoryExists,
    getCurrentDirectory: () => root,
    realpath: (path) => posix.resolve(root, path),
    getDirectories: (path) =>
      [...directories].filter(
        (directory) => posix.dirname(directory) === posix.resolve(root, path),
      ),
  }
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => settings,
    getScriptFileNames: () => [...text.keys()].filter((path) => /\.(?:[cm]?[jt]sx?)$/i.test(path)),
    getScriptVersion: () => '0',
    getScriptSnapshot: (path) => {
      const name = virtualName(path)
      return name ? snapshots.get(name) : undefined
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: () => `${root}/__no_host_library__.d.ts`,
    useCaseSensitiveFileNames: () => true,
    readFile,
    fileExists,
    directoryExists,
    getDirectories: resolutionHost.getDirectories,
    realpath: resolutionHost.realpath,
    resolveModuleNames: (names, containingFile) =>
      names.map(
        (name) =>
          ts.resolveModuleName(name, containingFile, settings, resolutionHost).resolvedModule,
      ),
  }
  const service = ts.createLanguageService(host)
  try {
    const program = service.getProgram()
    const source = program?.getSourceFile(fileName)
    if (!source) return []
    const start = source.getLineStarts()[request.line - 1]
    if (start == null) return []
    const next = source.getLineStarts()[request.line] ?? source.text.length
    const lineLength = source.text.slice(start, next).replace(/[\r\n]+$/, '').length
    if (request.column > lineLength + 1) return []
    const position = start + request.column - 1
    const definitions = (service.getDefinitionAtPosition(fileName, position) ?? []).filter(
      (definition) => definition.kind !== ts.ScriptElementKind.alias,
    )
    const occurrences =
      request.kind === 'definition'
        ? definitions
        : [
            ...(service.findReferences(fileName, position) ?? []),
            // Searching an import alias alone only finds that local alias's uses.
            // Search its resolved declaration too to include references across the project.
            ...definitions.flatMap(
              (definition) =>
                service.findReferences(definition.fileName, definition.textSpan.start) ?? [],
            ),
          ].flatMap((symbol) => symbol.references)
    const targets = new Map<string, NavigationTarget>()
    for (const occurrence of occurrences) {
      const targetName = virtualName(occurrence.fileName)
      const target = targetName ? program?.getSourceFile(targetName) : undefined
      if (!targetName || !target || !text.has(targetName)) continue
      const span = occurrence.textSpan
      const begin = target.getLineAndCharacterOfPosition(span.start)
      const end = target.getLineAndCharacterOfPosition(span.start + span.length)
      const value: NavigationTarget = {
        path: targetName.slice(root.length + 1),
        line: begin.line + 1,
        column: begin.character + 1,
        endLine: end.line + 1,
        endColumn: end.character + 1,
        name: target.text.slice(span.start, span.start + span.length),
      }
      targets.set(`${value.path}:${span.start}:${span.length}`, value)
    }
    return [...targets.values()].sort(
      (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column,
    )
  } finally {
    service.dispose()
  }
}
