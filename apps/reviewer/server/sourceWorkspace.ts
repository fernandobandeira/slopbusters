import { mkdir, mkdtemp, readFile, realpath, stat, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve } from 'node:path'
import type { LanguageServerConfig } from '../shared/languageServers'
import type { NavigationRequest } from '../shared/navigation'
import type { PullRequest } from '../shared/types'
import type { createSourceProjectLoader } from './fileContent'
import type { ReviewWorkspaces } from './reviewWorkspaces'

export type SourceProject = ReturnType<typeof createSourceProjectLoader>
export interface SourceWorkspace {
  directory: string
  root: string
  files: Map<string, string>
  warnings: string[]
  close: () => Promise<void>
}

const manifests: Record<string, string[]> = {
  go: ['go.mod', 'go.sum', 'go.work', 'go.work.sum'],
  rust: ['Cargo.toml', 'Cargo.lock'],
  java: ['pom.xml'],
  c_sharp: [],
  python: [],
}

/** Repository paths are never allowed to escape a workspace or create symlinks. */
export function workspacePath(directory: string, path: string): string {
  if (!path || path.includes('\\') || path.includes('\0') || isAbsolute(path))
    throw new Error('Invalid source workspace path.')
  const target = resolve(directory, path)
  const local = relative(directory, target)
  if (
    !local ||
    local === '..' ||
    local.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) ||
    isAbsolute(local)
  )
    throw new Error('Source path escapes the review workspace.')
  return target
}

export function projectRoot(paths: Set<string>, path: string, language: string): string {
  const marker =
    language === 'go'
      ? 'go.mod'
      : language === 'rust'
        ? 'Cargo.toml'
        : language === 'java'
          ? 'pom.xml'
          : undefined
  if (!marker) return ''
  let directory = posix.dirname(path)
  let root = ''
  while (true) {
    if (paths.has(posix.join(directory, marker))) {
      root = directory === '.' ? '' : directory
      // Rust workspaces may declare sibling crates in an ancestor manifest.
      if (language !== 'rust') break
    }
    if (directory === '.') break
    directory = posix.dirname(directory)
  }
  return root
}

export async function createSourceWorkspace(
  project: SourceProject,
  pull: PullRequest,
  request: NavigationRequest,
  server: LanguageServerConfig,
  workspaces?: ReviewWorkspaces,
): Promise<SourceWorkspace> {
  const tree = await project.tree(pull, request.side)
  const paths = new Set(tree.paths)
  const root = projectRoot(paths, request.path, server.language)
  const extensions = new Set(server.extensions)
  if (['c', 'cpp'].includes(server.language))
    for (const extension of ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx'])
      extensions.add(extension)
  const candidates = tree.paths
    .filter((path) => {
      if (root && !path.startsWith(`${root}/`)) return false
      const name = posix.basename(path)
      if (['sitecustomize.py', 'usercustomize.py'].includes(name)) return false
      return (
        extensions.has(path.split('.').at(-1)?.toLowerCase() ?? '') ||
        (manifests[server.language] ?? []).includes(name) ||
        (server.language === 'c_sharp' && /\.(?:csproj|sln|slnx)$/.test(path))
      )
    })
    .sort((left, right) => {
      const priority = (path: string) =>
        path === request.path
          ? 0
          : (manifests[server.language] ?? []).includes(posix.basename(path))
            ? 1
            : 2
      return priority(left) - priority(right) || left.localeCompare(right)
    })
  if (workspaces) {
    const lease = await workspaces.acquire(pull, tree.sha)
    try {
      const files = new Map<string, string>()
      const warnings = new Set(lease.workspace.warnings)
      for (const path of lease.workspace.paths) {
        if (!extensions.has(path.split('.').at(-1)?.toLowerCase() ?? '') && path !== request.path)
          continue
        const target = workspacePath(lease.workspace.directory, path)
        if ((await stat(target)).size > 2 * 1024 * 1024) {
          warnings.add('Some large source files cannot be opened as navigation targets.')
          continue
        }
        const content = await readFile(target, 'utf8')
        if (content.includes('\0') || Buffer.byteLength(content) > 2 * 1024 * 1024) {
          warnings.add('Some binary or large source files cannot be opened as navigation targets.')
          continue
        }
        files.set(path, content)
      }
      return {
        directory: lease.workspace.directory,
        root: root ? workspacePath(lease.workspace.directory, root) : lease.workspace.directory,
        files,
        warnings: [...warnings],
        close: async () => lease.release(),
      }
    } catch (error) {
      lease.release()
      throw error
    }
  }
  // Servers canonicalize macOS /var paths to /private/var in returned URIs.
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'slopbusters-source-')))
  const files = new Map<string, string>()
  const warnings = new Set(tree.warnings)
  let bytes = 0
  const started = Date.now()
  try {
    for (let index = 0; index < Math.min(candidates.length, 1000); index += 6) {
      if (bytes >= 32 * 1024 * 1024 || Date.now() - started > 60_000) break
      const batch = await Promise.all(
        candidates.slice(index, Math.min(index + 6, 1000)).map(async (path) => {
          try {
            return await project.file(pull, request.side, path)
          } catch {
            warnings.add(`Could not load ${path}; semantic navigation may be incomplete.`)
            return undefined
          }
        }),
      )
      for (const file of batch) {
        if (!file) continue
        const size = Buffer.byteLength(file.content)
        if (bytes + size > 32 * 1024 * 1024) continue
        const target = workspacePath(directory, file.path)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, file.content, { mode: 0o600 })
        files.set(file.path, file.content)
        bytes += size
      }
    }
    if (!files.has(request.path))
      throw new Error('Could not load the selected source file for semantic navigation.')
    if (files.size < candidates.length)
      warnings.add(
        'Semantic navigation uses a partial source snapshot (up to 1,000 files, 32 MiB and one minute of loading); additional definitions or references may be missing.',
      )
    warnings.add(
      'Semantic navigation uses saved repository sources and installed toolchains. Dependencies are not installed; generated code and external packages may be unavailable.',
    )
    return {
      directory,
      root: root ? workspacePath(directory, root) : directory,
      files,
      warnings: [...warnings],
      close: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
