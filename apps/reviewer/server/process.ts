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
  onOutput?: (text: string) => void
}): Promise<string> {
  if (params.signal?.aborted) return Promise.reject(new Error('The operation was cancelled.'))
  return new Promise((resolve, reject) => {
    const child = spawn(params.command, params.args, {
      cwd: params.cwd,
      env: params.env ? { ...process.env, ...params.env } : process.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    let errors = ''
    let bytes = 0
    let settled = false
    let failure: Error | undefined
    let exited = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch { /* The process group may already have exited. */ }
    }
    const settle = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      params.signal?.removeEventListener('abort', abort)
      if (error) reject(error)
      else resolve(params.includeStderr ? `${output}\n${errors}` : output)
    }
    const finish = (error?: Error) => {
      if (settled) return
      if (error && !failure) {
        failure = error
        clearTimeout(timer)
        params.signal?.removeEventListener('abort', abort)
        kill('SIGTERM')
        killTimer = setTimeout(() => {
          kill('SIGKILL')
          killTimer = undefined
          if (exited) settle(failure)
        }, 1000)
      }
      if (exited && !killTimer) settle(failure ?? error)
    }
    const abort = () => finish(new Error('The operation was cancelled.'))
    const timer = setTimeout(
      () => finish(new Error(`${params.command} timed out. Please try again.`)),
      params.timeoutMs ?? 60_000,
    )
    params.signal?.addEventListener('abort', abort, { once: true })
    if (params.signal?.aborted) abort()
    child.on('error', (error) => {
      // Spawn failures have no process group to wait for.
      if (!child.pid) settle(new Error(`Could not run ${params.command}: ${error.message}`))
      else finish(new Error(`Could not run ${params.command}: ${error.message}`))
    })
    child.stdout.on('data', (chunk: Buffer) => {
      params.onOutput?.(chunk.toString())
      bytes += chunk.length
      if (bytes > (params.maxOutputBytes ?? 24 * 1024 * 1024))
        finish(new Error('The response exceeded the local size limit.'))
      else output += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      params.onOutput?.(chunk.toString())
      errors = (errors + chunk.toString()).slice(-4000)
    })
    child.on('close', (code) => {
      exited = true
      if (failure) { if (!killTimer) settle(failure) }
      else settle(code === 0 ? undefined : new Error(errors.trim() || `${params.command} exited with code ${code}.`))
    })
    child.stdin.on('error', () => {
      /* Early process exits are reported by the close handler. */
    })
    child.stdin.end(params.input ?? '')
  })
}
