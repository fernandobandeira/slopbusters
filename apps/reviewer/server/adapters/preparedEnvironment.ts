import { mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { PullRequest } from '../../shared/types'
import type { SetupCommand } from '../../shared/workspaceSetup'
import { ReviewWorkspaces, type ReviewWorkspace } from '../reviewWorkspaces'
import type { LocalSourceRepository } from '../sourceRepository'
import { workspacePath } from '../sourceWorkspace'
import { runCommand } from '../process'
import { SETUP_COMMAND_TIMEOUT_MS } from '../limits'

const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
async function git(directory: string, args: string[], signal?: AbortSignal) {
  return runCommand({
    command: 'git',
    cwd: directory,
    args: ['-c', `core.hooksPath=${nullDevice}`, '-c', 'core.fsmonitor=false', ...args],
    signal,
    env: {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_CONFIG_COUNT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      GIT_TERMINAL_PROMPT: '0',
    },
  })
}

export async function assertPreparedSource(workspace: ReviewWorkspace) {
  const head = await git(workspace.directory, ['rev-parse', '--verify', 'HEAD'])
  const changes = await git(workspace.directory, ['diff', '--name-only', 'HEAD', '--'])
  if (head.trim() !== workspace.sha || changes.trim())
    throw new Error(
      'Setup changed committed source or the PR revision. This environment cannot be used for review; use your configured IDE instead.',
    )
}

export async function runSetupCommand(
  workspace: ReviewWorkspace,
  step: SetupCommand,
  signal: AbortSignal,
  onOutput: (text: string) => void,
) {
  const requested =
    step.directory === '.'
      ? workspace.directory
      : workspacePath(workspace.directory, step.directory)
  const cwd = await realpath(requested)
  const local = relative(workspace.directory, cwd)
  if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
    throw new Error('The setup command directory is outside the prepared environment.')
  return runCommand({
    command: step.command,
    args: step.args,
    cwd,
    signal,
    onOutput,
    timeoutMs: SETUP_COMMAND_TIMEOUT_MS,
    maxOutputBytes: 2 * 1024 * 1024,
    env: { CI: 'true', GIT_TERMINAL_PROMPT: '0' },
  })
}

/** Owns disposable clones only. Package managers retain their usual shared caches. */
export class PreparedEnvironmentStorage {
  private root?: Promise<string>
  constructor(
    private readonly dataDirectory: string,
    private readonly repository: LocalSourceRepository,
  ) {}

  private async createRoot() {
    const parent = join(this.dataDirectory, 'prepared-environments')
    await mkdir(parent, { recursive: true })
    await this.initialize()
    return mkdtemp(join(parent, `${process.pid}-`))
  }

  async initialize() {
    const parent = join(this.dataDirectory, 'prepared-environments')
    let entries
    try {
      entries = await readdir(parent, { withFileTypes: true })
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const pid = /^(\d+)-/.exec(entry.name)?.[1]
      if (!entry.isDirectory() || !pid) continue
      try {
        process.kill(Number(pid), 0)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
          await rm(join(parent, entry.name), { recursive: true, force: true })
      }
    }
  }

  async create(pull: PullRequest, sha: string, id: string) {
    const root = await (this.root ??= this.createRoot())
    const directory = join(root, id)
    const checkouts = new ReviewWorkspaces(directory, this.repository)
    try {
      const lease = await checkouts.acquire(pull, sha)
      lease.release()
      return {
        workspace: lease.workspace,
        dispose: async () => {
          await checkouts.close()
          await rm(directory, { recursive: true, force: true })
        },
      }
    } catch (error) {
      await checkouts.close()
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  async close() {
    if (this.root) await rm(await this.root, { recursive: true, force: true })
  }
}
