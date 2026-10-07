import { runCommand } from './process'
import { retryNetwork } from './network'
import { GIT_TIMEOUT_MS, MAX_GIT_OUTPUT_BYTES } from '../limits'

interface GitOptions {
  bare?: boolean
  signal?: AbortSignal
  maxOutputBytes?: number
  /** Retries dropped GitHub connections; pushes repeat only when nothing was sent. */
  network?: 'fetch' | 'push'
}

/** Both snapshots and checkouts ignore user configuration and never run hooks or filters. */
export function hardenedGit(directory: string, args: string[], options: GitOptions = {}) {
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const run = () =>
    runCommand({
      command: 'git',
      args: [
        '-c',
        `core.hooksPath=${nullDevice}`,
        '-c',
        'core.symlinks=false',
        '-c',
        'core.autocrlf=false',
        ...(options.bare ? ['--git-dir', directory] : ['-C', directory]),
        ...args,
      ],
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: nullDevice,
        GIT_LFS_SKIP_SMUDGE: '1',
        // Do not inherit command-scoped configuration from the parent process.
        GIT_CONFIG_COUNT: '0',
      },
      signal: options.signal,
      timeoutMs: GIT_TIMEOUT_MS,
      maxOutputBytes: options.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES,
    })
  if (!options.network) return run()
  return retryNetwork(run, { idempotent: options.network === 'fetch', signal: options.signal })
}
