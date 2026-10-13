import { describe, expect, it, vi } from 'vitest'
import { organizePull } from '../server/features/organization/organize'
import { Provider } from '../shared/domain/types'
import { required } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

describe('organization model selection', () => {
  it.each([Provider.codex, Provider.claude])(
    'asks %s to group the diff in a scratch directory',
    async (provider) => {
      const pull = fixturePull()
      const { turns, requests } = recordingTurns(() => ({
        groups: pull.groups.map(({ title, priority, reason, hunkIds }) => ({
          title,
          priority,
          reason,
          hunkIds,
        })),
      }))
      const signal = new AbortController().signal
      const observer = vi.fn()
      const model = { provider, model: 'custom-model-version' }

      const groups = await organizePull(turns, pull, model, { signal, observer })

      expect(groups).toHaveLength(pull.groups.length)
      const request = required(requests[0])
      expect(request).toMatchObject({
        model,
        signal,
        observer,
        purpose: 'Organize · review-room/example#128',
      })
      expect(request.directory).toBeUndefined()
      expect(request.prompt).toContain(required(pull.files[0]?.hunks[0]).id)
    },
  )
})
