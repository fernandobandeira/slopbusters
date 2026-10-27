import { cp, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { logError } from '../errors'
import { INSPECTION_COPY_TIMEOUT_MS, MAX_INSPECTION_LISTED_FILES } from '../limits'
import { runCommand } from './process'

/**
 * Repository files that agents or editors act on when an agent starts in a directory, and that a
 * repository could use to run commands or widen permissions: Claude Code settings, hooks, agents
 * and commands, project MCP servers, Codex, Cursor, Gemini and VS Code configuration, and Git
 * metadata, whose config and hooks run commands (`core.fsmonitor`, `core.pager`, hooks). Agents
 * load these from their working directory, the copy's root. Instruction files such as `CLAUDE.md`
 * and `AGENTS.md` stay: prompts treat repository files as untrusted data.
 */
export const INSPECTION_EXCLUDED_PATHS = [
  '.claude',
  '.mcp.json',
  '.codex',
  '.cursor',
  '.gemini',
  '.vscode',
  '.git',
] as const

/**
 * A disposable copy of `source` at `destination` (which must not exist) for an agent to inspect,
 * without the repository's agent configuration. Nothing the agent does there reaches `source`.
 * On macOS the copy is a copy-on-write clone; elsewhere, or if cloning fails, a plain copy.
 * `git` keeps the Git metadata. Only pass it for a repository Slopbusters created itself, without
 * hooks or configuration that runs commands, such as Gandalf's merge checkout.
 */
export async function copyForInspection(
  source: string,
  destination: string,
  signal?: AbortSignal,
  options: { git?: boolean } = {},
): Promise<void> {
  const from = resolve(source)
  const excluded = scrubbedPaths(options)
  if (!(await cloneTree(from, destination, signal))) {
    signal?.throwIfAborted()
    await cp(from, destination, {
      recursive: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
      filter: (path) => !isExcluded(relative(from, path), excluded),
    })
  }
  await Promise.all(
    excluded.map((path) => rm(join(destination, path), { recursive: true, force: true })),
  )
}

/** Clone with APFS `clonefile` through `cp -c`; false when that is unavailable. */
async function cloneTree(source: string, destination: string, signal?: AbortSignal) {
  if (process.platform !== 'darwin') return false
  try {
    await runCommand({
      command: '/bin/cp',
      args: ['-cR', source, destination],
      timeoutMs: INSPECTION_COPY_TIMEOUT_MS,
      signal,
    })
    return true
  } catch (error) {
    signal?.throwIfAborted()
    logError('Copy-on-write clone failed; copying the directory instead', error)
    await rm(destination, { recursive: true, force: true })
    return false
  }
}

function scrubbedPaths(options: { git?: boolean }): readonly string[] {
  return options.git
    ? INSPECTION_EXCLUDED_PATHS.filter((path) => path !== '.git')
    : INSPECTION_EXCLUDED_PATHS
}

function isExcluded(path: string, excluded: readonly string[]) {
  const top = path.split(sep)[0]
  return excluded.some((candidate) => candidate === top)
}

/** The files under `directory`, relative and sorted, up to the listing limit; never Git metadata. */
export async function listInspectionFiles(
  directory: string,
): Promise<{ paths: string[]; truncated: boolean }> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const paths = entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .filter((path) => path.split(sep)[0] !== '.git')
    .sort()
  return {
    paths: paths.slice(0, MAX_INSPECTION_LISTED_FILES),
    truncated: paths.length > MAX_INSPECTION_LISTED_FILES,
  }
}
