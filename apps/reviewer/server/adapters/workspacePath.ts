import { isAbsolute, relative, resolve } from 'node:path'

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
