import { MAX_NAVIGATION_TARGETS, MAX_PROJECT_FILE_BYTES } from '../limits.ts'
import ts from 'typescript'
import { findTypeScriptReferences } from './typeScriptReferences.ts'
import { parentPort, workerData } from 'node:worker_threads'
import { realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { workspacePackagePaths } from '../features/navigation/workspacePackages.ts'
import type {
  NavigationRequest,
  NavigationResult,
  NavigationTarget,
} from '../../shared/domain/navigation.ts'

const { directory, paths, libDirectory } = workerData as {
  directory: string
  paths: string[]
  libDirectory: string
}
const available = new Set(paths)
const libraries = realpathSync(libDirectory)
const projects = new Map<
  string,
  { service: ts.LanguageService; warnings: string[]; options: ts.CompilerOptions }
>()
const within = (root: string, path: string) => {
  const local = relative(root, path)
  return !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`)
}
function allowed(path: string) {
  try {
    const target = realpathSync(path)
    return within(directory, target) || within(libraries, target)
  } catch {
    return false
  }
}
const readFile = (path: string) =>
  allowed(path) && statSync(path).size <= MAX_PROJECT_FILE_BYTES ? ts.sys.readFile(path) : undefined
const host = {
  getCurrentDirectory: () => directory,
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  fileExists: (path) => allowed(path) && ts.sys.fileExists(path),
  readFile,
  directoryExists: (path) => allowed(path) && ts.sys.directoryExists(path),
  readDirectory: (path, extensions, excludes, includes, depth) =>
    allowed(path)
      ? ts.sys.readDirectory(path, extensions, excludes, includes, depth).filter(allowed)
      : [],
  getDirectories: (path) =>
    allowed(path) ? ts.sys.getDirectories(path).filter((child) => allowed(join(path, child))) : [],
  realpath: (path) => (allowed(path) ? realpathSync(path) : path),
} satisfies ts.ParseConfigHost & ts.ModuleResolutionHost

function configuration(path: string) {
  let current = dirname(path)
  let config: string | undefined
  while (within(directory, current)) {
    config = ['tsconfig.json', 'jsconfig.json']
      .map((name) => join(current, name))
      .find(host.fileExists)
    if (config || current === directory) break
    current = dirname(current)
  }
  if (!config) return undefined
  const json = ts.readConfigFile(config, readFile)
  if (json.error)
    return {
      ...ts.parseJsonConfigFileContent({}, host, dirname(config)),
      errors: [json.error],
      path: config,
    }
  return {
    ...ts.parseJsonConfigFileContent(json.config, host, dirname(config), undefined, config),
    path: config,
  }
}

function project(file: string) {
  const config = configuration(file)
  const key = config?.path ?? directory
  const existing = projects.get(key)
  if (existing) return existing
  const warnings = (config?.errors ?? [])
    .filter((error) => error.code !== 18003)
    .map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' '))
  const packagePaths: Record<string, string[]> = {}
  for (const manifest of paths.filter((path) => /(^|\/)package\.json$/.test(path))) {
    const content = readFile(join(directory, manifest))
    if (!content) continue
    const options =
      configuration(join(directory, dirname(manifest), '__source__.ts'))?.options ?? {}
    Object.assign(
      packagePaths,
      workspacePackagePaths(manifest, content, available, options, directory.split(sep).join('/')),
    )
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    allowJs: true,
    ...config?.options,
    paths: { ...packagePaths, ...config?.options.paths },
    noEmit: true,
    plugins: [],
  }
  const files = new Set(
    config?.fileNames ??
      paths.filter((path) => /\.[cm]?[jt]sx?$/i.test(path)).map((path) => join(directory, path)),
  )
  files.add(file)
  const snapshots = new Map<string, ts.IScriptSnapshot>()
  const service = ts.createLanguageService({
    ...host,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCompilationSettings: () => options,
    getScriptFileNames: () => [...files],
    getScriptVersion: () => '0',
    getScriptSnapshot: (path) => {
      const saved = snapshots.get(path)
      if (saved) return saved
      const content = readFile(path)
      if (content === undefined) return undefined
      const snapshot = ts.ScriptSnapshot.fromString(content)
      snapshots.set(path, snapshot)
      return snapshot
    },
    getCurrentDirectory: () => directory,
    getDefaultLibFileName: (settings) => join(libraries, ts.getDefaultLibFileName(settings)),
    getProjectReferences: () => config?.projectReferences,
  })
  const value = { service, warnings, options }
  projects.set(key, value)
  while (projects.size > 3) {
    const oldest = projects.keys().next().value!
    projects.get(oldest)!.service.dispose()
    projects.delete(oldest)
  }
  return value
}

function navigate(request: NavigationRequest): NavigationResult {
  if (!available.has(request.path)) throw new Error('This file is not in the reviewed revision.')
  const fileName = resolve(directory, request.path)
  const { service, warnings: diagnostics, options } = project(fileName)
  const source = service.getProgram()?.getSourceFile(fileName)
  if (!source) throw new Error('The selected source file could not be analyzed.')
  const start = source.getLineStarts()[request.line - 1]
  const line = source.text.split('\n')[request.line - 1]?.replace(/\r$/, '')
  if (
    start === undefined ||
    line === undefined ||
    request.column < 1 ||
    request.column > line.length + 1
  )
    throw new Error('The selected source position is outside this file.')
  const position = start + request.column - 1
  const definitions = (service.getDefinitionAtPosition(fileName, position) ?? []).filter(
    (item) => item.kind !== ts.ScriptElementKind.alias,
  )
  const occurrences =
    request.kind === 'definition'
      ? definitions
      : request.kind === 'implementation'
        ? (service.getImplementationAtPosition(fileName, position) ?? [])
        : findTypeScriptReferences(service, fileName, position, definitions)
  const targets = new Map<string, NavigationTarget>()
  const warnings = new Set(diagnostics)
  for (const occurrence of occurrences) {
    const path = relative(directory, occurrence.fileName).split(sep).join('/')
    const target = service.getProgram()?.getSourceFile(occurrence.fileName)
    if (!target || !available.has(path)) {
      warnings.add(
        'Some definitions belong to dependencies outside the committed source and cannot be opened in this review.',
      )
      continue
    }
    const begin = target.getLineAndCharacterOfPosition(occurrence.textSpan.start)
    const end = target.getLineAndCharacterOfPosition(
      occurrence.textSpan.start + occurrence.textSpan.length,
    )
    const value = {
      path,
      line: begin.line + 1,
      column: begin.character + 1,
      endLine: end.line + 1,
      endColumn: end.character + 1,
      name: target.text.slice(
        occurrence.textSpan.start,
        occurrence.textSpan.start + occurrence.textSpan.length,
      ),
    }
    targets.set(`${path}:${value.line}:${value.column}`, value)
    if (targets.size >= MAX_NAVIGATION_TARGETS) {
      warnings.add(`Navigation is limited to ${MAX_NAVIGATION_TARGETS} locations.`)
      break
    }
  }
  if (!targets.size) {
    for (const imported of ts.preProcessFile(source.text, true, true).importedFiles) {
      if (!ts.resolveModuleName(imported.fileName, fileName, options, host).resolvedModule)
        warnings.add(
          `Cannot resolve ${imported.fileName}. Its dependency, generated source, or project configuration may be unavailable in this checkout.`,
        )
    }
  }
  return {
    language: /\.[cm]?jsx?$/i.test(request.path) ? 'javascript' : 'typescript',
    mode: 'semantic',
    targets: [...targets.values()],
    warnings: [...warnings],
  }
}

parentPort?.on('message', ({ id, request }: { id: number; request: NavigationRequest }) => {
  try {
    parentPort?.postMessage({ id, result: navigate(request) })
  } catch (error) {
    parentPort?.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Source analysis failed.',
    })
  }
})
