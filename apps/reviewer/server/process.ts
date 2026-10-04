import { spawn } from 'node:child_process'

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
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: params.env ? { ...process.env, ...params.env } : process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
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
        child.kill('SIGTERM')
        reject(error)
      } else resolve(params.includeStderr ? `${output}\n${errors}` : output)
    }
    const abort = () => finish(new Error('The operation was cancelled.'))
    const timer = setTimeout(
      () => finish(new Error(`${params.command} timed out. Please try again.`)),
      params.timeoutMs ?? 60_000,
    )
    params.signal?.addEventListener('abort', abort, { once: true })
    if (params.signal?.aborted) abort()
    child.on('error', (error) =>
      finish(new Error(`Could not run ${params.command}: ${error.message}`)),
    )
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > (params.maxOutputBytes ?? 24 * 1024 * 1024))
        finish(new Error('The response exceeded the local size limit.'))
      else output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-4000)
    })
    child.on('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new Error(errors.trim() || `${params.command} exited with code ${code}.`),
      ),
    )
    child.stdin.on('error', () => {
      /* Early process exits are reported by the close handler. */
    })
    child.stdin.end(params.input ?? '')
  })
}
