import { describe, expect, it, vi } from 'vitest'
import { organizePull } from '../../../../server/features/organization/organize'
import { Provider } from '../../../../shared/domain/types'
import { z } from 'zod'
import { fixtureGroupingReply } from '../../../fixtures/grouping'
import { required } from '../../../fixtures/required'
import { fixturePull } from '../../../fixtures/pull'
import { recordingTurns } from '../../../fixtures/turns'

describe('organization model selection', () => {
  it.each([Provider.codex, Provider.claude])(
    'asks %s to group the diff in a scratch directory',
    async (provider) => {
      const pull = fixturePull()
      pull.transfers = []
      const reply = fixtureGroupingReply(pull)
      const { turns, requests } = recordingTurns(() => reply)
      const signal = new AbortController().signal
      const observer = vi.fn()
      const model = { provider, model: 'custom-model-version' }

      const groups = await organizePull(turns, pull, model, { signal, observer })

      expect(groups).toMatchObject(reply.rest)
      const request = required(requests[0])
      expect(request).toMatchObject({
        model,
        signal,
        observer,
        purpose: 'Organize · review-room/example#128',
      })
      expect(request.directory).toBeUndefined()
      expect(() => z.toJSONSchema(request.schema, { target: 'draft-7' })).not.toThrow()
      expect(request.prompt).toContain(
        JSON.stringify({
          title: pull.title,
          sections: pull.files.flatMap((file) =>
            file.hunks.map((hunk) => ({
              id: hunk.id,
              path: file.path,
              ...(hunk.sourceHunkId ? { gitHunk: hunk.sourceHunkId } : {}),
              header: hunk.header,
              code: hunk.lines.map(({ kind, text }) => `${kind}: ${text}`).join('\n'),
            })),
          ),
        }),
      )
      expect(request.prompt).not.toContain(pull.description)
      expect(request.prompt).not.toContain('"description":')
    },
  )
})
