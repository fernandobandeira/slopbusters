import {
  COMMAND_TIMEOUT_MS,
  MAX_COMMAND_OUTPUT_BYTES,
  PROCESS_TERMINATION_MS,
  MAX_STDERR_CHARS,
} from '../limits'
import { spawn, type ChildProcess } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

export class CommandTimeoutError extends Error {
  constructor(command: string) {
    super(`${command} timed out. Please try again.`)
    this.name = 'CommandTimeoutError'
  }
}

export function runCommand(params: {
  command: string
  args: string[]
  input?: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  signal?: AbortSignal
  includeStderr?: boolean
  maxOutputBytes?: number
  onStdout?: (chunk: string) => void
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: params.env ? { ...process.env, ...params.env } : process.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const decoder = new StringDecoder('utf8')
    let output = ''
    let errors = ''
    let bytes = 0
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', abort)
      if (error) {
        terminateCommand(child)
        reject(error)
      } else resolve(params.includeStderr ? `${output}\n${errors}` : output)
    }
    const abort = () => {
      finish(new Error('The operation was cancelled.'))
    }
    const timer = setTimeout(() => {
      finish(new CommandTimeoutError(params.command))
    }, params.timeoutMs ?? COMMAND_TIMEOUT_MS)
    params.signal?.addEventListener('abort', abort, { once: true })
    if (params.signal?.aborted) abort()
    child.on('error', (error) => {
      finish(new Error(`Could not run ${params.command}: ${error.message}`))
    })
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > (params.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES))
        finish(new Error('The response exceeded the local size limit.'))
      else {
        const text = decoder.write(chunk)
        output += text
        notifyOutput(params.onStdout, text, finish)
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-MAX_STDERR_CHARS)
    })
    child.on('close', (code) => {
      const tail = decoder.end()
      output += tail
      if (tail) notifyOutput(params.onStdout, tail, finish)
      finish(
        code === 0
          ? undefined
          : new Error(errors.trim() || `${params.command} exited with code ${code}.`),
      )
    })
    child.stdin.on('error', () => {
      /* Early process exits are reported by the close handler. */
    })
    child.stdin.end(params.input ?? '')
  })
}

function notifyOutput(
  observer: ((text: string) => void) | undefined,
  text: string,
  finish: (error: Error) => void,
) {
  try {
    observer?.(text)
  } catch (cause) {
    finish(cause instanceof Error ? cause : new Error('Could not record provider output.'))
  }
}

function terminateCommand(child: ChildProcess) {
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal)
      else child.kill(signal)
    } catch {
      /* The process group may already have exited. */
    }
  }
  kill('SIGTERM')
  setTimeout(() => {
    kill('SIGKILL')
  }, PROCESS_TERMINATION_MS).unref()
}
