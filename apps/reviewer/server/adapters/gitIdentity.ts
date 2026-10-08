import { z } from 'zod'
import { runCommand } from './process'
import type { GitHub } from './github'

export interface GitIdentity {
  name: string
  email: string
}

export const GANDALF_IDENTITY: GitIdentity = {
  name: 'Gandalf',
  email: 'gandalf@slopbusters.local',
}

const userSchema = z.object({ id: z.number(), login: z.string(), name: z.string().nullable() })

/**
 * Commits on the user's PRs carry the user's own Git identity. Workspaces ignore user Git
 * configuration, so the identity is read here. Without one, the GitHub account's noreply
 * address still attributes the commit to the user.
 */
export function createGitIdentity(github: GitHub, run = runCommand) {
  async function configured(key: string) {
    try {
      return (await run({ command: 'git', args: ['config', '--global', '--get', key] })).trim()
    } catch {
      return ''
    }
  }
  return async (signal?: AbortSignal): Promise<GitIdentity> => {
    const [name, email] = await Promise.all([configured('user.name'), configured('user.email')])
    if (name && email) return { name, email }
    try {
      const user = userSchema.parse(await github.rest('user', { signal }))
      return {
        name: name || user.name || user.login,
        email: email || `${String(user.id)}+${user.login}@users.noreply.github.com`,
      }
    } catch {
      return GANDALF_IDENTITY
    }
  }
}
