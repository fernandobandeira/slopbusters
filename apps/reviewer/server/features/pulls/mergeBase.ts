import { z } from 'zod'
import type { PullRequest } from '../../../shared/domain/types'
import type { GitHub } from '../../adapters/github'
import { createCache } from '../../cache'

export function createMergeBaseLookup(github: GitHub) {
  const cache = createCache<string>({ max: 100 })
  const sha = z.string().regex(/^[a-f\d]{40}(?:[a-f\d]{24})?$/i)
  return (pull: Pick<PullRequest, 'owner' | 'repo' | 'baseSha' | 'headSha' | 'mergeBaseSha'>) => {
    if (pull.mergeBaseSha) return Promise.resolve(sha.parse(pull.mergeBaseSha))
    const key = `${pull.owner}/${pull.repo}/${pull.baseSha}/${pull.headSha}`
    return cache.load(key, async () => {
      const value = await github.rest(
        `repos/${pull.owner}/${pull.repo}/compare/${pull.baseSha}...${pull.headSha}`,
        {
          jq: '.merge_base_commit.sha',
          raw: true,
          maxOutputBytes: 1024,
        },
      )
      return sha.parse(z.string().parse(value).trim())
    })
  }
}
