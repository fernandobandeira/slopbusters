import { cp, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { logError } from '../errors'
import { INSPECTION_COPY_TIMEOUT_MS } from '../limits'
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
 */
export async function copyForInspection(
  source: string,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  const from = resolve(source)
  if (!(await cloneTree(from, destination, signal))) {
    signal?.throwIfAborted()
    await cp(from, destination, {
      recursive: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
      filter: (path) => !isExcluded(relative(from, path)),
    })
  }
  await Promise.all(
    INSPECTION_EXCLUDED_PATHS.map((path) =>
      rm(join(destination, path), { recursive: true, force: true }),
    ),
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

function isExcluded(path: string) {
  const top = path.split(sep)[0]
  return INSPECTION_EXCLUDED_PATHS.some((excluded) => excluded === top)
}
