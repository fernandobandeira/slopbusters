import { describe, expect, it, vi } from 'vitest'
import { foldAnswers, reviewTicket } from '../../../../server/features/jobs/ticketReview'
import { Provider } from '../../../../shared/domain/types'
import { required } from '../../../fixtures/bob'
import { fixtureJobsAdvice, fixtureTicket } from '../../../fixtures/tickets'
import { recordingTurns } from '../../../fixtures/turns'

const model = { provider: Provider.claude, model: 'claude-opus-5-5' }
const signal = new AbortController().signal

describe('Jobs model inputs', () => {
  it('reads the default-branch checkout to verify code claims', async () => {
    const { turns, requests } = recordingTurns(() => fixtureJobsAdvice())
    const observer = vi.fn()
    const repository = { directory: '/checkouts/main', sha: 'main-sha', release: vi.fn() }

    await reviewTicket({
      turns,
      evidence: '{"ticket":"SCH-760"}',
      ticket: fixtureTicket(),
      model,
      skill: 'Jobs skill',
      signal,
      repository,
      observer,
      companion: false,
    })

    const request = required(requests[0])
    expect(request).toMatchObject({
      model,
      signal,
      directory: '/checkouts/main',
      observer,
      purpose: 'Jobs primary review · SCH-760',
    })
    expect(request.prompt).toContain(
      "The current directory is a checkout of the repository's default branch at commit main-sha",
    )
    expect(request.prompt).toContain('Do not modify files')
    expect(request.prompt).not.toContain('MCP')
  })
  it('folds answers without a checkout in a scratch directory', async () => {
    const { turns, requests } = recordingTurns(() => fixtureJobsAdvice({ resolved: [] }))
    const previous = fixtureJobsAdvice()

    await foldAnswers({
      turns,
      evidence: '{}',
      ticket: fixtureTicket(),
      model,
      skill: 'Jobs skill',
      signal,
      previous,
      answers: [],
    })

    const request = required(requests[0])
    expect(request.directory).toBeUndefined()
    expect(request.purpose).toBe('Jobs answers · SCH-760')
    expect(request.prompt).toContain('No repository checkout is available')
  })
})
