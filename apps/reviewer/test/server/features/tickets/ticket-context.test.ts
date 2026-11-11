import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { LinearError, type Linear } from '../../../../server/adapters/linear'
import { ReviewerStore } from '../../../../server/adapters/store'
import { LinusJobs } from '../../../../server/features/linus/linusJobs'
import {
  loadLinusSkill,
  reconcileWithLinus,
  reviewWithLinus,
} from '../../../../server/features/linus/linusReview'
import { createTicketLinks } from '../../../../server/features/tickets/ticketLinks'
import type { GitHub } from '../../../../server/adapters/github'
import type { LinusAdvice } from '../../../../shared/domain/linus'
import { Provider } from '../../../../shared/domain/types'
import { required } from '../../../fixtures/required'
import { fixturePull } from '../../../fixtures/pull'
import { recordingTurns } from '../../../fixtures/turns'

vi.mock('../../../../server/features/linus/linusReview', () => ({
  loadLinusSkill: vi.fn(),
  reviewWithLinus: vi.fn(),
  reconcileWithLinus: vi.fn(),
}))
const keep: LinusAdvice = {
  verdict: 'keep',
  reasoning: 'One logical change.',
  revisedTitle: '',
  revisedDescription: '',
  layers: [],
  limitations: [],
  disagreements: [],
  steps: [{ text: 'Keep it together.', emotion: 'happy', target: 'overview', reference: '' }],
}
afterEach(() => {
  vi.resetAllMocks()
})

describe('linked tickets as review evidence', () => {
  it('gives both Linus reviewers and the reconciliation the PR’s ticket', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ticket-context-'))
    const store = new ReviewerStore({ dataDirectory: directory })
    store.savePreferences({
      organization: { provider: Provider.codex, model: 'gpt-6.1-sol' },
      companion: { provider: Provider.claude, model: 'claude-opus-5-5' },
    })
    vi.mocked(loadLinusSkill).mockResolvedValue('Linus')
    vi.mocked(reviewWithLinus).mockResolvedValue(keep)
    vi.mocked(reconcileWithLinus).mockResolvedValue(keep)
    const context = vi.fn(() => Promise.resolve('{"identifier":"SCH-760"}'))
    const jobs = new LinusJobs({
      store,
      turns: recordingTurns().turns,
      staticDirectory: directory,
      loadPull: () => Promise.resolve(fixturePull()),
      context,
    })
    try {
      const session = jobs.start('review-room/example', [fixturePull().url])
      await vi.waitFor(() => {
        expect(jobs.get(session.id).status).toBe('complete')
      })
      expect(vi.mocked(reviewWithLinus).mock.calls.map(([request]) => request.context)).toEqual([
        '{"identifier":"SCH-760"}',
        '{"identifier":"SCH-760"}',
      ])
      expect(required(vi.mocked(reconcileWithLinus).mock.calls[0])[0].pending.context).toBe(
        '{"identifier":"SCH-760"}',
      )
    } finally {
      await jobs.close()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('finding the ticket a PR implements', () => {
  const pull = {
    url: 'https://github.com/acme/app/pull/9',
    headBranch: 'fix/utf-8',
    title: 'Fix utf-8',
  }
  function linear(handler: (query: string, variables: Record<string, unknown>) => unknown): Linear {
    return {
      configured: () => true,
      request: <T>(query: string, variables: Record<string, unknown>, schema: z.ZodType<T>) =>
        Promise.resolve().then(() => schema.parse(handler(query, variables))),
    }
  }
  const github = {} as GitHub
  it('prefers Linear’s own PR link', async () => {
    const links = createTicketLinks(
      linear(() => ({ attachmentsForURL: { nodes: [{ issue: { identifier: 'SCH-760' } }] } })),
      github,
    )
    expect(await links.forPull(pull)).toBe('SCH-760')
  })
  it('confirms a key named in the title before trusting it', async () => {
    const seen: string[] = []
    const links = createTicketLinks(
      linear((query, variables) => {
        if (query.includes('attachmentsForURL')) return { attachmentsForURL: { nodes: [] } }
        if (query.includes('issueVcsBranchSearch')) return { issueVcsBranchSearch: null }
        seen.push(String(variables.id))
        if (variables.id === 'SCH-760') return { issue: { identifier: 'SCH-760' } }
        throw new LinearError('Linear could not find this issue.', 404, 'not-found')
      }),
      github,
    )
    expect(
      await links.forPull({ ...pull, url: `${pull.url}0`, title: 'SCH-760 Collect deposits' }),
    ).toBe('SCH-760')
    expect(
      await links.forPull({ ...pull, title: 'Fix decoding', headBranch: 'fix/utf-8' }),
    ).toBeNull()
    expect(seen).toEqual(['SCH-760', 'UTF-8'])
  })
})
