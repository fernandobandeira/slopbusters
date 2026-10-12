import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { ORCHESTRATION_PROTOCOL_VERSION } from '@t3tools/contracts'
import { UserError } from '../../errors'
import { T3_ENGINE_REQUEST_TIMEOUT_MS } from '../../limits'

/** A T3 Code engine that is running on this machine and speaks the protocol we were built for. */
export interface RunningEngine {
  readonly home: string
  readonly origin: string
  readonly environmentId: string
  readonly serverVersion: string
}

const runtimeStateSchema = z.object({ pid: z.number().int(), origin: z.url() })
const descriptorSchema = z.object({
  environmentId: z.string().min(1),
  serverVersion: z.string().min(1),
  // Missing metadata denotes protocol 1, as in the engine's own descriptor schema.
  orchestrationProtocolVersion: z.number().int().optional(),
})

/** The T3 home the desktop app and `t3` CLI share, unless T3CODE_HOME points elsewhere. */
export function t3Home(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.T3CODE_HOME?.trim() || join(homedir(), '.t3')
}

/**
 * Find the engine T3 Code is running. Its server records its origin in the T3 home; the pid
 * check rejects a stale file whose port another process has since taken.
 */
export async function findRunningEngine(
  home = t3Home(),
  dependencies: { fetch?: typeof fetch; isAlive?: (pid: number) => boolean } = {},
): Promise<RunningEngine> {
  const state = await readRuntimeState(home)
  if (!state || !(dependencies.isAlive ?? isProcessAlive)(state.pid))
    throw new UserError('Open T3 Code first. Slopbusters starts Linus in your running T3 Code.')
  const descriptor = await fetchDescriptor(state.origin, dependencies.fetch ?? fetch)
  const protocol = descriptor.orchestrationProtocolVersion ?? 1
  if (protocol !== ORCHESTRATION_PROTOCOL_VERSION)
    throw new UserError(
      `T3 Code ${descriptor.serverVersion} speaks engine protocol ${protocol}, but this Slopbusters build speaks ${ORCHESTRATION_PROTOCOL_VERSION}. Update ${protocol > ORCHESTRATION_PROTOCOL_VERSION ? 'Slopbusters' : 'T3 Code'}.`,
    )
  return {
    home,
    origin: state.origin,
    environmentId: descriptor.environmentId,
    serverVersion: descriptor.serverVersion,
  }
}

async function readRuntimeState(home: string) {
  try {
    const text = await readFile(join(home, 'userdata', 'server-runtime.json'), 'utf8')
    const parsed = runtimeStateSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

async function fetchDescriptor(origin: string, fetchImpl: typeof fetch) {
  let response: Response
  try {
    response = await fetchImpl(new URL('/.well-known/t3/environment', origin), {
      signal: AbortSignal.timeout(T3_ENGINE_REQUEST_TIMEOUT_MS),
    })
  } catch {
    throw new UserError('T3 Code is not answering. Restart T3 Code and try again.')
  }
  const parsed = descriptorSchema.safeParse(await response.json().catch(() => undefined))
  if (!response.ok || !parsed.success)
    throw new UserError('T3 Code returned an unexpected environment description.')
  return parsed.data
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}
