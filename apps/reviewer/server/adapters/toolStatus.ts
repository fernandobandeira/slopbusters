import { TOOL_STATUS_TIMEOUT_MS, TOOL_VERSION_TIMEOUT_MS } from '../limits'
import { z } from 'zod'
import type { AppStatus, ToolStatus } from '../../shared/domain/types'
import { runCommand } from './process'
import { createGitHub, type GitHub } from './github'

const profileSchema = z.object({ login: z.string().min(1), avatarUrl: z.url(), url: z.url() })

async function githubStatus(github: GitHub): Promise<AppStatus['github']> {
  try {
    const output = await github.rest('user', {
      jq: '{login:.login,avatarUrl:.avatar_url,url:.html_url}',
      timeoutMs: TOOL_STATUS_TIMEOUT_MS,
    })
    const profile = profileSchema.parse(output)
    return { available: true, authenticated: true, detail: profile.login, profile }
  } catch {
    return {
      available: false,
      detail: 'GitHub account unavailable. Check gh authentication and connectivity.',
    }
  }
}

export function codexAuthentication(output: string): boolean | undefined {
  if (/\bnot logged in\b/i.test(output)) return false
  if (/\blogged in\b/i.test(output)) return true
  return undefined
}

export function claudeAuthentication(output: string): boolean | undefined {
  try {
    const status: unknown = JSON.parse(output)
    if (
      typeof status === 'object' &&
      status !== null &&
      'loggedIn' in status &&
      typeof status.loggedIn === 'boolean'
    )
      return status.loggedIn
  } catch {
    /* Older CLI releases may not support the auth status command. */
  }
  return undefined
}

async function providerAuthentication(provider: 'codex' | 'claude'): Promise<boolean | undefined> {
  const parse = provider === 'codex' ? codexAuthentication : claudeAuthentication
  try {
    const output = await runCommand({
      command: provider,
      args: provider === 'codex' ? ['login', 'status'] : ['auth', 'status', '--json'],
      includeStderr: provider === 'codex',
      timeoutMs: TOOL_VERSION_TIMEOUT_MS,
    })
    return parse(output)
  } catch (cause: unknown) {
    // Codex reports a signed-out account on stderr with a nonzero exit code.
    // Return only a parsed state; auth output and command errors never reach the API.
    return provider === 'codex' &&
      cause instanceof Error &&
      codexAuthentication(cause.message) === false
      ? false
      : undefined
  }
}

async function providerStatus(provider: 'codex' | 'claude'): Promise<ToolStatus> {
  try {
    const output = await runCommand({
      command: provider,
      args: ['--version'],
      timeoutMs: TOOL_VERSION_TIMEOUT_MS,
    })
    const authenticated = await providerAuthentication(provider)
    return { available: true, detail: output.trim().split('\n')[0] || 'Installed', authenticated }
  } catch {
    return { available: false, detail: `Install ${provider} in your terminal.` }
  }
}

export async function getAppStatus(adapter: GitHub = createGitHub()): Promise<AppStatus> {
  const [github, codex, claude] = await Promise.all([
    githubStatus(adapter),
    providerStatus('codex'),
    providerStatus('claude'),
  ])
  return { github, codex, claude }
}
