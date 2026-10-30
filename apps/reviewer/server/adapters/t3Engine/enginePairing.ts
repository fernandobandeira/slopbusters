import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { runCommand } from '../process'
import { logError, UserError } from '../../errors'
import { T3_ENGINE_PAIR_TIMEOUT_MS, T3_ENGINE_REQUEST_TIMEOUT_MS } from './limits'
import type { RunningEngine } from './engineLocation'

/** How Slopbusters appears in T3 Code's connections list. */
export const ENGINE_CLIENT_LABEL = 'Slopbusters'

export interface EngineAccess {
  readonly accessToken: string
  readonly expiresAt: number
}

/** A command that runs T3 Code's own `t3` CLI. */
export interface EngineCli {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

const tokenResultSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal('Bearer'),
  expires_in: z.number().nonnegative(),
})

const MAC_APP_NAMES = ['T3 Code (Alpha).app', 'T3 Code.app']

/**
 * Locate the `t3` CLI that belongs to the running engine. Newer desktop builds keep a launcher in
 * the T3 home; older macOS builds run the CLI bundled in the app the same way that launcher does;
 * a CLI install puts `t3` on PATH.
 */
export function findEngineCli(
  home: string,
  exists: (path: string) => boolean = existsSync,
  platform = process.platform,
): EngineCli {
  const env = { T3CODE_HOME: home }
  const launcher = join(home, 'bin', platform === 'win32' ? 't3.cmd' : 't3')
  if (exists(launcher)) return { command: launcher, args: [], env }
  const app = platform === 'darwin' ? macApplicationCli(exists) : undefined
  if (app) return { ...app, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } }
  return { command: 't3', args: [], env }
}

/** The installed macOS app's executable, run as Node on the server entry inside its archive. */
function macApplicationCli(exists: (path: string) => boolean) {
  const apps = ['/Applications', join(homedir(), 'Applications')].flatMap((directory) =>
    MAC_APP_NAMES.map((name) => ({ app: join(directory, name), name: name.replace(/\.app$/, '') })),
  )
  const found = apps.find(({ app, name }) => exists(join(app, 'Contents', 'MacOS', name)))
  if (!found) return undefined
  const resources = join(found.app, 'Contents', 'Resources', 'app.asar')
  return {
    command: join(found.app, 'Contents', 'MacOS', found.name),
    args: [join(resources, 'apps', 'server', 'dist', 'bin.mjs')],
  }
}

/**
 * Pair with the engine: mint a short-lived one-time token with `t3 pair`, then exchange it for a
 * bearer access token through the engine's OAuth token-exchange endpoint.
 */
export async function pairWithEngine(
  engine: RunningEngine,
  dependencies: PairingDependencies & { fetch?: typeof fetch; now?: () => number } = {},
): Promise<EngineAccess> {
  const pairingToken = await mintPairingToken(engine, ENGINE_CLIENT_LABEL, dependencies)
  return exchangePairingToken(engine.origin, pairingToken, dependencies)
}

interface PairingDependencies {
  cli?: EngineCli
  run?: typeof runCommand
}

/**
 * A one-time pairing token from `t3 pair`. A browser that opens an engine page with it in the URL
 * hash signs in as `label`.
 */
export async function mintPairingToken(
  engine: RunningEngine,
  label: string,
  dependencies: PairingDependencies = {},
): Promise<string> {
  const cli = dependencies.cli ?? findEngineCli(engine.home)
  const output = await (dependencies.run ?? runCommand)({
    command: cli.command,
    args: [...cli.args, 'pair', '--label', label, '--ttl', '2m'],
    env: cli.env,
    timeoutMs: T3_ENGINE_PAIR_TIMEOUT_MS,
  }).catch((cause: unknown) => {
    logError('Pairing with T3 Code', cause)
    throw new UserError('Slopbusters could not pair with T3 Code. Make sure T3 Code is open.')
  })
  return parsePairingToken(output)
}

/** The one-time token from `t3 pair` output, which also prints a QR code and a pairing URL. */
export function parsePairingToken(output: string): string {
  const token = /^Token:\s*(\S+)\s*$/m.exec(output)?.[1]
  if (!token) throw new UserError('T3 Code did not return a pairing token. Update T3 Code.')
  return token
}

export async function exchangePairingToken(
  origin: string,
  pairingToken: string,
  dependencies: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<EngineAccess> {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: pairingToken,
    subject_token_type: 'urn:t3:params:oauth:token-type:environment-bootstrap',
    requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    client_label: ENGINE_CLIENT_LABEL,
    client_device_type: 'desktop',
  })
  const response = await (dependencies.fetch ?? fetch)(new URL('/oauth/token', origin), {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(T3_ENGINE_REQUEST_TIMEOUT_MS),
  })
  const parsed = tokenResultSchema.safeParse(await response.json().catch(() => undefined))
  if (!response.ok || !parsed.success)
    throw new UserError('T3 Code refused the pairing. Try again, or restart T3 Code.')
  return {
    accessToken: parsed.data.access_token,
    expiresAt: (dependencies.now ?? Date.now)() + parsed.data.expires_in * 1000,
  }
}
