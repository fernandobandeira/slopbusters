import { z } from 'zod'
import type { GitHub } from '../../adapters/github'

/** Opening and updating the PRs of a stack; only what publishing a split needs. */
export interface SplitPulls {
  create: (
    repository: { owner: string; repo: string },
    request: { title: string; body: string; head: string; base: string; draft: boolean },
    signal?: AbortSignal,
  ) => Promise<{ url: string; number: number }>
  update: (
    repository: { owner: string; repo: string },
    number: number,
    changes: { title?: string; body?: string; base?: string },
    signal?: AbortSignal,
  ) => Promise<void>
}

const createdSchema = z.object({ html_url: z.string(), number: z.number().int().positive() })

export function createSplitPulls(github: GitHub): SplitPulls {
  return {
    async create({ owner, repo }, request, signal) {
      const created = createdSchema.parse(
        await github.rest(`repos/${owner}/${repo}/pulls`, {
          method: 'POST',
          body: request,
          signal,
        }),
      )
      return { url: created.html_url, number: created.number }
    },
    async update({ owner, repo }, number, changes, signal) {
      await github.rest(`repos/${owner}/${repo}/pulls/${String(number)}`, {
        method: 'PATCH',
        body: changes,
        signal,
      })
    },
  }
}
