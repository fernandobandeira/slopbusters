import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../server/process'
import { getAppStatus } from '../server/toolStatus'

vi.mock('../server/process', () => ({ runCommand: vi.fn() }))
const command = vi.mocked(runCommand)
const githubProfile = {
  login: 'reviewer',
  avatarUrl: 'https://avatars.githubusercontent.com/u/1',
  url: 'https://github.com/reviewer',
}

beforeEach(() => {
  command.mockReset()
})

describe('app connection status', () => {
  it('returns the GitHub profile and verified provider sign-in without auth output or email', async () => {
    command.mockImplementation(async ({ command: tool, args }) => {
      if (tool === 'gh') return JSON.stringify(githubProfile)
      if (args[0] === '--version') return `${tool} 1.0.0`
      if (tool === 'codex') return 'Logged in using an API key: REDACTED_AUTH_VALUE'
      return JSON.stringify({
        loggedIn: true,
        email: 'private@example.test',
        authMethod: 'claude.ai',
      })
    })

    const status = await getAppStatus()

    expect(status.github.profile).toEqual(githubProfile)
    expect(status.codex).toMatchObject({ available: true, authenticated: true })
    expect(status.claude).toMatchObject({ available: true, authenticated: true })
    expect(JSON.stringify(status)).not.toContain('REDACTED_AUTH_VALUE')
    expect(JSON.stringify(status)).not.toContain('private@example.test')
    expect(command).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'codex', args: ['login', 'status'], includeStderr: true }),
    )
  })

  it('distinguishes signed out from installed with unknown authentication', async () => {
    command.mockImplementation(async ({ command: tool, args }) => {
      if (tool === 'gh') return JSON.stringify(githubProfile)
      if (args[0] === '--version') return `${tool} 1.0.0`
      if (tool === 'codex') throw new Error('Not logged in')
      throw new Error('Unknown auth status option')
    })

    const status = await getAppStatus()

    expect(status.codex).toMatchObject({ available: true, authenticated: false })
    expect(status.claude.available).toBe(true)
    expect(status.claude.authenticated).toBeUndefined()
  })

  it('does not treat an installed CLI or malformed auth response as a signed-in account', async () => {
    command.mockImplementation(async ({ command: tool, args }) => {
      if (tool === 'gh') throw new Error('Not authenticated')
      if (tool === 'codex') throw new Error('Not installed')
      if (args[0] === '--version') return 'claude 1.0.0'
      return JSON.stringify({ loggedIn: 'true', email: 'private@example.test' })
    })

    const status = await getAppStatus()

    expect(status.github.available).toBe(false)
    expect(status.codex.available).toBe(false)
    expect(status.claude.available).toBe(true)
    expect(status.claude.authenticated).toBeUndefined()
    expect(command).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: 'codex', args: ['login', 'status'] }),
    )
    expect(JSON.stringify(status)).not.toContain('private@example.test')
  })
})
