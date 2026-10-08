import { describe, expect, it, vi } from 'vitest'
import { createGitIdentity, GANDALF_IDENTITY } from '../server/adapters/gitIdentity'
import type { GitHub } from '../server/adapters/github'
import type { runCommand } from '../server/adapters/process'

function fixture(config: Record<string, string>, user?: unknown) {
  const run = vi.fn<typeof runCommand>(({ args }) => {
    const value = config[args.at(-1) ?? '']
    return value ? Promise.resolve(`${value}\n`) : Promise.reject(new Error('exit 1'))
  })
  const rest = vi.fn<GitHub['rest']>(() =>
    user ? Promise.resolve(user) : Promise.reject(new Error('gh is not signed in')),
  )
  const identity = createGitIdentity({ rest, paginate: vi.fn(), graphql: vi.fn() }, run)
  return { identity, run, rest }
}

describe('commit identity for Gandalf updates', () => {
  it("uses the user's global Git identity", async () => {
    const { identity, run, rest } = fixture({
      'user.name': 'Ada Lovelace',
      'user.email': 'ada@example.com',
    })
    expect(await identity()).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' })
    expect(run).toHaveBeenCalledWith({
      command: 'git',
      args: ['config', '--global', '--get', 'user.email'],
    })
    expect(rest).not.toHaveBeenCalled()
  })
  it('falls back to the GitHub account and its noreply address', async () => {
    const { identity } = fixture({}, { id: 583231, login: 'octo', name: null })
    expect(await identity()).toEqual({
      name: 'octo',
      email: '583231+octo@users.noreply.github.com',
    })
  })
  it('keeps a configured name when only the email is missing', async () => {
    const { identity } = fixture({ 'user.name': 'Octo Cat' }, { id: 1, login: 'octo', name: 'X' })
    expect(await identity()).toEqual({ name: 'Octo Cat', email: '1+octo@users.noreply.github.com' })
  })
  it('signs as Gandalf when neither Git nor GitHub knows the user', async () => {
    const { identity } = fixture({})
    expect(await identity()).toEqual(GANDALF_IDENTITY)
  })
})
