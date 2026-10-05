import { VIRTUAL_ROOT } from '../../limits.ts'
import { posix } from 'node:path'
import type ts from 'typescript'

function entryPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(entryPaths)
  if (!value || typeof value !== 'object') return []
  const conditions = value as Record<string, unknown>
  return ['source', 'types', 'import', 'require', 'default'].flatMap((key) =>
    entryPaths(conditions[key]),
  )
}

/** Map a saved package's published entry points back to source without installing or building it. */
export function workspacePackagePaths(
  manifestPath: string,
  content: string,
  available: Set<string>,
  options: ts.CompilerOptions,
  workspaceRoot = VIRTUAL_ROOT,
): Record<string, string[]> {
  let manifest: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    manifest = parsed as Record<string, unknown>
  } catch {
    return {}
  }
  if (typeof manifest.name !== 'string' || !manifest.name) return {}
  const directory = posix.dirname(manifestPath)
  const packageRoot = directory === '.' ? '' : `${directory}/`
  const relativeOption = (path?: string) =>
    path?.startsWith(`${workspaceRoot}/`) ? path.slice(workspaceRoot.length + 1) : path
  const sourceRoot = relativeOption(options.rootDir) ?? `${packageRoot}src`
  const outputRoot = relativeOption(options.outDir)

  function exists(path: string) {
    if (!path.startsWith(packageRoot) || path.startsWith('../') || path.startsWith('/'))
      return false
    if (!path.includes('*')) return available.has(path)
    const [prefix = '', suffix = ''] = path.split('*')
    return [...available].some(
      (candidate) => candidate.startsWith(prefix) && candidate.endsWith(suffix),
    )
  }

  function sourceEntry(entry: string): string | undefined {
    const path = posix.normalize(posix.join(directory, entry))
    const candidates = [path]
    if (outputRoot && path.startsWith(`${outputRoot}/`))
      candidates.unshift(posix.join(sourceRoot, path.slice(outputRoot.length + 1)))
    else {
      const relative = path.slice(packageRoot.length)
      if (/^(dist|lib|build)\//.test(relative))
        candidates.unshift(posix.join(sourceRoot, relative.replace(/^[^/]+\//, '')))
    }
    for (const candidate of candidates) {
      const stem = candidate.replace(/(?:\.d)?\.(?:[cm]?[jt]sx?)$/, '')
      const source = [
        ...['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].map(
          (extension) => stem + extension,
        ),
        candidate,
      ].find(exists)
      if (source) return `${workspaceRoot}/${source}`
    }
    return undefined
  }

  const paths: Record<string, string[]> = {}
  const exports = manifest.exports
  const subpaths =
    exports && typeof exports === 'object' && !Array.isArray(exports)
      ? (exports as Record<string, unknown>)
      : undefined
  const rootExport =
    subpaths && Object.keys(subpaths).some((key) => key.startsWith('.')) ? subpaths['.'] : exports
  const entries = [
    ...entryPaths(manifest.source),
    ...entryPaths(rootExport),
    ...entryPaths(manifest.types ?? manifest.typings),
    ...entryPaths(manifest.module),
    ...entryPaths(manifest.main),
    './src/index.ts',
    '../../index.ts',
  ]
  const root = entries.map(sourceEntry).find((entry) => entry !== undefined)
  if (root) paths[manifest.name] = [root]
  for (const [subpath, entry] of Object.entries(subpaths ?? {})) {
    if (!subpath.startsWith('./')) continue
    const source = entryPaths(entry)
      .map(sourceEntry)
      .find((value) => value !== undefined)
    if (source) paths[`${manifest.name}/${subpath.slice(2)}`] = [source]
  }
  return paths
}
