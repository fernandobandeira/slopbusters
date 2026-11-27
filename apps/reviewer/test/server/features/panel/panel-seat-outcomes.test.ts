import { describe, expect, it, vi } from 'vitest'
import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../../../../server/adapters/t3Engine/engineTurns'
import { getPanel } from '../../../../shared/api'
import { fixturePanelAdvice } from '../../../fixtures/panel'
import {
  everyone,
  isGrounding,
  panelHarness,
  primary,
  reply,
  repository,
  url,
} from '../../../fixtures/panelJobs'
import { fixturePull } from '../../../fixtures/pull'
import { recordingTurns } from '../../../fixtures/turns'

const harness = panelHarness()
const panel = harness.panel

describe('saved outcomes for panel seats', () => {
  it('waits on the user when a reviewer fails, then grounds the reviews that finished', async () => {
    const { turns, requests } = recordingTurns((request) => {
      if (request.purpose?.startsWith('Terminator')) throw new Error('Terminator crashed')
      if (request.purpose?.startsWith('Uncle Bob')) return fixturePanelAdvice([])
      return reply(request)
    })
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    expect(jobs.get(session.id).progress).toMatch(/^Terminator could not finish/)
    expect(requests.some(isGrounding)).toBe(false)

    jobs.continue(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const grounding = requests.find(isGrounding)
    const saved = getPanel.response.parse({
      revision: 1,
      session: harness.store.panel.get(session.id),
    }).session
    const reviews = saved?.results[0]?.reviews
    expect(reviews?.find((review) => review.reviewer === 'unclebob')).toMatchObject({
      outcome: 'completed',
      advice: { findings: [] },
    })
    expect(reviews?.find((review) => review.reviewer === 'terminator')).toEqual({
      reviewer: 'terminator',
      outcome: 'failed',
      error: 'Terminator failed.',
    })
    expect(grounding?.prompt).not.toContain('- terminator:')
    expect(jobs.get(session.id).results[0]?.advice.limitations.join(' ')).toMatch(
      /grounding saw 2 of 3 reviews/,
    )
  })

  it('saves a cancelled seat alongside a review that finished', async () => {
    const recorded = recordingTurns(reply)
    const turns: StructuredTurns = {
      run: <T>(request: StructuredTurnRequest<T>) => {
        if (!request.purpose?.startsWith('Terminator')) return recorded.turns.run(request)
        return new Promise<T>((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => {
              reject(new Error('Cancelled'))
            },
            {
              once: true,
            },
          )
        })
      },
    }
    const jobs = panel(turns)
    const session = await jobs.start(repository, [url], ['unclebob', 'terminator'])
    await vi.waitFor(() => {
      expect(harness.store.panel.get(session.id)?.pending?.reviews).toHaveLength(1)
    })

    jobs.cancel(session.id)
    await jobs.close()

    const saved = harness.store.panel.get(session.id)
    expect(saved?.status).toBe('cancelled')
    expect(saved?.pending?.reviews).toEqual([
      expect.objectContaining({ reviewer: 'unclebob', outcome: 'completed' }),
      { reviewer: 'terminator', outcome: 'cancelled' },
    ])
  })
})

it('saves missing seats as cancelled when the app stopped during a panel', () => {
  const completed = {
    reviewer: 'unclebob',
    outcome: 'completed' as const,
    advice: fixturePanelAdvice(),
  }
  harness.store.panel.save({
    id: 'interrupted',
    repository,
    urls: [url],
    model: primary,
    reviewers: [
      { id: 'unclebob', name: 'Uncle Bob', maxFindings: 10 },
      { id: 'terminator', name: 'Terminator', maxFindings: 10 },
    ],
    status: 'running',
    progress: 'Reviewing…',
    results: [],
    pending: { pull: fixturePull(), fingerprint: 'fp', reviews: [completed] },
    createdAt: new Date().toISOString(),
  })
  const jobs = panel(recordingTurns(reply).turns)

  expect(jobs.get('interrupted').status).toBe('cancelled')

  const saved = harness.store.panel.get('interrupted')
  expect(saved?.status).toBe('cancelled')
  expect(saved?.pending?.reviews).toEqual([
    completed,
    { reviewer: 'terminator', outcome: 'cancelled' },
  ])
})
