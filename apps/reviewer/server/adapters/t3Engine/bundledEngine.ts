import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { logError, UserError } from '../../errors'
import {
  MAX_STDERR_CHARS,
  T3_ENGINE_START_POLL_MS,
  T3_ENGINE_START_TIMEOUT_MS,
  T3_ENGINE_STOP_TIMEOUT_MS,
} from '../../limits'
import { findRunningEngine, isProcessAlive, type RunningEngine } from './engineLocation'
import type { EngineCli } from './enginePairing'

export interface BundledEngineOptions {
  /** The `t3` executable shipped with Slopbusters, at the release its contracts are pinned to. */
  readonly executable: string
  /** Slopbusters' own T3 home: its projects, threads, worktrees and settings. */
  readonly home: string
  readonly locate?: (home: string) => Promise<RunningEngine>
  readonly spawnEngine?: (executable: string, args: string[]) => ChildProcess
  readonly freePort?: () => Promise<number>
  /** Stop an engine a previous run left behind, before this run starts its own. */
  readonly stopLeftover?: (pid: number) => Promise<void>
  /** Hears an engine that stopped on its own, with its exit status and last output. */
  readonly onUnexpectedExit?: (report: string) => void
}

/**
 * The T3 Code engine Slopbusters ships and runs itself, in its own home and on its own loopback
 * port. It always speaks this build's protocol, and its threads never appear in the user's T3
 * Code. It starts on first use and stops with the server. It is always this run's own child: an
 * engine an earlier run left behind is stopped, since its output went to a process that is gone
 * and no one would hear it exit.
 */
export class BundledEngine {
  private starting: Promise<RunningEngine> | undefined
  private child: ChildProcess | undefined
  private closed = false

  constructor(private readonly options: BundledEngineOptions) {}

  /** The `t3` CLI for this engine's home, for pairing. */
  cli(): EngineCli {
    return { command: this.options.executable, args: [], env: { T3CODE_HOME: this.options.home } }
  }

  ensureRunning(): Promise<RunningEngine> {
    if (this.closed) return Promise.reject(new UserError('Slopbusters is shutting down.'))
    this.starting ??= this.start().catch((error: unknown) => {
      this.starting = undefined
      throw error
    })
    return this.starting
  }

  async close(): Promise<void> {
    this.closed = true
    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = new Promise((resolve) => child.once('exit', resolve))
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), T3_ENGINE_STOP_TIMEOUT_MS)
    await exited
    clearTimeout(timer)
  }

  private async start(): Promise<RunningEngine> {
    const locate = this.options.locate ?? ((home: string) => findRunningEngine(home))
    // A previous run that did not shut down cleanly may have left its engine running.
    const leftover = await locate(this.options.home).catch(() => undefined)
    if (leftover) await (this.options.stopLeftover ?? stopProcess)(leftover.pid)
    if (!existsSync(this.options.executable))
      throw new UserError('This Slopbusters build does not include the T3 Code engine.')
    const port = await (this.options.freePort ?? freeLoopbackPort)()
    const child = (this.options.spawnEngine ?? spawnEngine)(this.options.executable, [
      'serve',
      '--base-dir',
      this.options.home,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
    ])
    this.child = child
    const output = captureOutput(child)
    child.once('exit', (code, signal) => {
      if (this.child !== child) return
      // The next use starts another engine.
      this.child = undefined
      this.starting = undefined
      if (this.closed) return
      const report = `${new Date().toISOString()} The bundled T3 Code engine stopped: exit code ${String(code)}, signal ${String(signal)}\n${output()}\n`
      if (this.options.onUnexpectedExit) this.options.onUnexpectedExit(report)
      else recordExit(this.options.home, report)
    })
    return this.waitUntilReady(child, locate, output)
  }

  private async waitUntilReady(
    child: ChildProcess,
    locate: (home: string) => Promise<RunningEngine>,
    output: () => string,
  ): Promise<RunningEngine> {
    const deadline = Date.now() + T3_ENGINE_START_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        logError('Starting the bundled T3 Code engine', output())
        throw new UserError('The T3 Code engine Slopbusters includes stopped while starting.')
      }
      const engine = await locate(this.options.home).catch(() => undefined)
      if (engine && engine.pid === child.pid) return engine
      await delay(T3_ENGINE_START_POLL_MS)
    }
    logError('Starting the bundled T3 Code engine', output())
    child.kill('SIGTERM')
    throw new UserError('The T3 Code engine Slopbusters includes took too long to start.')
  }
}

/** Log an engine that stopped on its own, and keep a copy in its home for later diagnosis. */
function recordExit(home: string, report: string) {
  logError('The bundled T3 Code engine stopped', report)
  try {
    appendFileSync(join(home, 'slopbusters-engine-exits.log'), report)
  } catch {
    /* The console log above still has it. */
  }
}

function spawnEngine(executable: string, args: string[]): ChildProcess {
  return spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })
}

/** Keep the tail of the engine's output for diagnosing a failed start; drain the rest. */
function captureOutput(child: ChildProcess): () => string {
  let tail = ''
  const keep = (chunk: Buffer) => {
    tail = (tail + chunk.toString()).slice(-MAX_STDERR_CHARS)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  return () => tail
}

function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('No loopback port was available.'))
      })
    })
  })
}

/** Ask a process to stop, and kill it if it is still there after the stop timeout. */
async function stopProcess(pid: number): Promise<void> {
  signalProcess(pid, 'SIGTERM')
  const deadline = Date.now() + T3_ENGINE_STOP_TIMEOUT_MS
  while (isProcessAlive(pid) && Date.now() < deadline) await delay(T3_ENGINE_START_POLL_MS)
  if (isProcessAlive(pid)) signalProcess(pid, 'SIGKILL')
}

function signalProcess(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(pid, signal)
  } catch {
    /* It exited in the meantime. */
  }
}
