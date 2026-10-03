import ts from 'typescript'
import { posix } from 'node:path'
import type { NavigationRequest, NavigationResult, NavigationTarget } from '../shared/navigation'
import type { PullRequest } from '../shared/types'
import type { createSourceProjectLoader } from './fileContent'
import { getSyntaxIdentifierLocations, sourceLanguage } from './treeSymbols'
import { navigateTypeScript } from './semanticNavigation'

type SourceProject = ReturnType<typeof createSourceProjectLoader>
const virtualRoot = '/review/'
const maximumFiles = 120
const maximumBytes = 8 * 1024 * 1024

function selectedWord(content: string, line: number, column: number): string {
  const text = content.split('\n')[line - 1]?.replace(/\r$/, '')
  if (text == null || column < 1 || column > text.length + 1)
    throw new Error('The selected source position is outside this file.')
  const character = /[\p{L}\p{N}_$]/u
  let start = Math.min(column - 1, text.length)
  let end = start
  while (start > 0 && character.test(text[start - 1])) start--
  while (end < text.length && character.test(text[end])) end++
  return text.slice(start, end).slice(0, 200)
}

function nearby(path: string, candidate: string): number {
  const directory = posix.dirname(path).split('/')
  const parts = candidate.split('/')
  let shared = 0
  while (directory[shared] && directory[shared] === parts[shared]) shared++
  return shared
}

function plainMatches(path: string, content: string, name: string): NavigationTarget[] {
  const targets: NavigationTarget[] = []
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_$])${escaped}(?![\\p{L}\\p{N}_$])`, 'gu')
  content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      if (targets.length >= 500) return
      targets.push({
        path,
        name,
        line: index + 1,
        column: match.index + 1,
        endLine: index + 1,
        endColumn: match.index + name.length + 1,
      })
    }
  })
  return targets
}

/** Loads a bounded, immutable virtual project; reviewed packages and configuration are never run. */
export function createSourceNavigator(project: SourceProject) {
  const active = new Map<string, Promise<NavigationResult>>()
  const cache = new Map<string, NavigationResult>()

  async function navigate(
    pull: PullRequest,
    request: NavigationRequest,
  ): Promise<NavigationResult> {
    const tree = await project.tree(pull, request.side)
    const origin = await project.file(pull, request.side, request.path)
    const language = sourceLanguage(request.path)
    const semantic = language === 'typescript' || language === 'javascript'
    const searchesProject = request.kind !== 'definition'
    const searchesDeclarations = request.kind === 'definition' || request.kind === 'implementation'
    const name = selectedWord(origin.content, request.line, request.column)
    const warnings = new Set(tree.warnings)
    if (!name) return { language, mode: semantic ? 'semantic' : 'text', targets: [], warnings: [] }
    const available = new Set(tree.paths)
    const files = new Map<string, string>([[request.path, origin.content]])
    const revisions = new Map([[request.path, origin]])
    let bytes = Buffer.byteLength(origin.content)
    let attempted = 1
    const visited = new Set([request.path])
    const started = Date.now()
    let limited = false

    async function load(path: string) {
      if (visited.has(path) || !available.has(path)) return
      if (attempted >= maximumFiles || bytes >= maximumBytes || Date.now() - started > 30_000) {
        limited = true
        return
      }
      visited.add(path)
      attempted++
      try {
        const file = await project.file(pull, request.side, path)
        const size = Buffer.byteLength(file.content)
        if (bytes + size > maximumBytes) {
          limited = true
          return
        }
        bytes += size
        files.set(path, file.content)
        revisions.set(path, file)
      } catch {
        warnings.add(`Could not analyze ${path}; navigation results may be incomplete.`)
      }
    }
    async function loadMany(paths: string[]) {
      for (let index = 0; index < paths.length; index += 6) {
        if (attempted >= maximumFiles || bytes >= maximumBytes || Date.now() - started > 30_000) {
          limited = true
          break
        }
        await Promise.all(paths.slice(index, index + 6).map(load))
      }
    }

    let projectDirectory = ''
    let compilerOptions: ts.CompilerOptions = {}
    if (semantic) {
      let directory = posix.dirname(request.path)
      let config: string | undefined
      while (true) {
        config = ['tsconfig.json', 'jsconfig.json']
          .map((base) => posix.join(directory, base))
          .find((path) => available.has(path))
        if (config || directory === '.') break
        directory = posix.dirname(directory)
      }
      if (config) {
        projectDirectory = posix.dirname(config) === '.' ? '' : posix.dirname(config)
        if (searchesProject && projectDirectory)
          warnings.add(
            `Navigation is scoped to the configured project in ${projectDirectory}; other projects may contain additional locations.`,
          )
        async function optionsFrom(path: string, depth: number): Promise<ts.CompilerOptions> {
          if (depth > 8 || visited.has(path)) return {}
          await load(path)
          const text = files.get(path)
          if (!text) return {}
          const parsed = ts.parseConfigFileTextToJson(path, text)
          if (parsed.error || !parsed.config || typeof parsed.config !== 'object') {
            warnings.add(`Could not read ${path}; default source resolution is in use.`)
            return {}
          }
          const configDirectory = `${virtualRoot}${posix.dirname(path)}`
          const inherited =
            typeof parsed.config.extends === 'string' && parsed.config.extends.startsWith('.')
              ? posix.normalize(posix.join(posix.dirname(path), parsed.config.extends))
              : undefined
          if (typeof parsed.config.extends === 'string' && !parsed.config.extends.startsWith('.'))
            warnings.add(
              `Package-based inherited configuration for ${path} is unavailable in the saved repository source.`,
            )
          let parent: ts.CompilerOptions = {}
          if (inherited) {
            const parentPath = available.has(inherited) ? inherited : `${inherited}.json`
            if (available.has(parentPath)) parent = await optionsFrom(parentPath, depth + 1)
            else
              warnings.add(
                `The inherited configuration for ${path} is unavailable in this revision.`,
              )
          }
          const converted = ts.convertCompilerOptionsFromJson(
            parsed.config.compilerOptions ?? {},
            configDirectory,
          )
          const own = converted.options
          if (own.paths && !own.baseUrl && !parent.baseUrl) own.baseUrl = configDirectory
          return { ...parent, ...own }
        }
        compilerOptions = await optionsFrom(config, 0)
      }
    }
    const candidates = tree.paths
      .filter((path) => {
        if (semantic)
          return (
            /\.[cm]?[jt]sx?$/i.test(path) &&
            (!projectDirectory || path.startsWith(`${projectDirectory}/`))
          )
        if (language !== 'text') return sourceLanguage(path) === language
        return posix.extname(path) === posix.extname(request.path)
      })
      .sort(
        (left, right) =>
          nearby(request.path, right) - nearby(request.path, left) || left.localeCompare(right),
      )

    if (searchesProject || !semantic) await loadMany(candidates)
    if (semantic) {
      const options: ts.CompilerOptions = {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowJs: true,
        ...compilerOptions,
      }
      const resolver: ts.ModuleResolutionHost = {
        fileExists: (path) => available.has(path.slice(virtualRoot.length)),
        readFile: (path) => files.get(path.slice(virtualRoot.length)),
        directoryExists: (directory) =>
          tree.paths.some((path) => `${virtualRoot}${path}`.startsWith(`${directory}/`)),
        realpath: (path) => path,
      }
      const processed = new Set<string>()
      for (let pass = 0; pass < 12; pass++) {
        const imports = new Set<string>()
        for (const [path, content] of files) {
          if (processed.has(path) || !/\.[cm]?[jt]sx?$/i.test(path)) continue
          processed.add(path)
          for (const imported of ts.preProcessFile(content, true, true).importedFiles) {
            const resolved = ts.resolveModuleName(
              imported.fileName,
              `${virtualRoot}${path}`,
              options,
              resolver,
            ).resolvedModule
            if (resolved?.resolvedFileName.startsWith(virtualRoot))
              imports.add(resolved.resolvedFileName.slice(virtualRoot.length))
          }
        }
        const unseen = [...imports].filter((path) => !visited.has(path))
        if (!unseen.length) break
        await loadMany(unseen)
        if (pass === 11) limited = true
      }
      if (limited)
        warnings.add(
          `Navigation analyzed up to ${maximumFiles} files and 8 MiB of source; more results may exist.`,
        )
      return {
        language,
        mode: 'semantic',
        targets: navigateTypeScript(files, request, compilerOptions).slice(0, 500),
        warnings: [...warnings],
      }
    }

    warnings.add(
      searchesDeclarations
        ? `Possible ${request.kind === 'implementation' ? 'implementations' : 'definitions'} are matched by syntax and name. Type and scope resolution is unavailable for this language.`
        : 'These are source matches, not semantic references; unrelated symbols can share the same name.',
    )
    const targets: NavigationTarget[] = []
    for (const [path, file] of revisions) {
      if (searchesDeclarations) {
        for (const symbol of file.symbols) {
          if (
            symbol.name
              .split('.')
              .at(-1)
              ?.replace(/^(get|set) /, '') !== name
          )
            continue
          const line = file.content.split('\n')[symbol.line - 1] ?? ''
          const column = Math.max(1, line.indexOf(name) + 1)
          targets.push({
            path,
            name: symbol.name,
            line: symbol.line,
            column,
            endLine: symbol.line,
            endColumn: column + name.length,
          })
        }
      } else
        targets.push(
          ...((await getSyntaxIdentifierLocations(path, file.content, name)) ??
            plainMatches(path, file.content, name)),
        )
      if (targets.length >= 500) {
        limited = true
        break
      }
    }
    if (limited)
      warnings.add(
        `Navigation analyzed up to ${maximumFiles} files, 8 MiB of source and 500 matches; more results may exist.`,
      )
    return { language, mode: 'text', targets: targets.slice(0, 500), warnings: [...warnings] }
  }

  return function sourceNavigation(
    pull: PullRequest,
    request: NavigationRequest,
  ): Promise<NavigationResult> {
    const key = JSON.stringify([
      pull.owner,
      pull.repo,
      pull.baseSha,
      pull.headSha,
      pull.mergeBaseSha,
      request,
    ])
    const value = cache.get(key)
    if (value) return Promise.resolve(value)
    const pending = active.get(key)
    if (pending) return pending
    const result = navigate(pull, request)
      .then((value) => {
        cache.set(key, value)
        if (cache.size > 40) cache.delete(cache.keys().next().value!)
        return value
      })
      .finally(() => active.delete(key))
    active.set(key, result)
    return result
  }
}
