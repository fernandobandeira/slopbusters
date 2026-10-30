import { describe, expect, it, vi } from 'vitest'
import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../server/adapters/t3Engine/engineTurns'
import { activePanels, startEach } from '../server/features/panel/panelBatches'
import {
  groundingReply,
  isGrounding,
  panelHarness,
  reply,
  repository,
  url,
} from './fixtures/panelJobs'
import { fixturePull } from './fixtures/pull'

const harness = panelHarness()
const panel = harness.panel

const urlFor = (number: number) => url.replace(/\/pull\/\d+$/, `/pull/${String(number)}`)
const loadPull = (target: string) =>
  Promise.resolve({ ...fixturePull(), url: target, number: Number(/\d+$/.exec(target)?.[0]) })
/** The fixture reply, with grounded fixes placed on the PR the turn grounds. */
const onItsPull = (request: StructuredTurnRequest<unknown>) => {
  if (!isGrounding(request)) return reply(request)
  const grounded = groundingReply(request)
  const pull = Number(/#(\d+)$/.exec(request.purpose ?? '')?.[1])
  return {
    ...grounded,
    entries: grounded.entries.map((entry) => ({
      ...entry,
      destination: { ...entry.destination, pull },
    })),
  }
}
/** A turn that runs until its panel is cancelled, even when that happened before it began. */
const hanging: StructuredTurns = {
  run: ({ signal }) =>
    new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new Error('Cancelled'))
      signal.addEventListener('abort', () => {
        reject(new Error('Cancelled'))
      })
    }),
}

describe('panels on several PRs', () => {
  it('reviews each PR on its own, two at a time, and queues the rest', async () => {
    const waiting: (() => void)[] = []
    const turns: StructuredTurns = {
      run: async <T>(request: StructuredTurnRequest<T>) => {
        if (!isGrounding(request)) await new Promise<void>((resolve) => waiting.push(resolve))
        return request.schema.parse(onItsPull(request))
      },
    }
    const jobs = panel(turns, { loadPull })

    const { panels, skipped } = await startEach(jobs, {
      repository,
      urls: [urlFor(1), urlFor(2), urlFor(3)],
      reviewers: ['unclebob'],
    })

    expect(skipped).toEqual([])
    expect(new Set(panels.map((item) => item.sessionId)).size).toBe(3)
    await vi.waitFor(() => {
      expect(waiting).toHaveLength(2)
      expect(
        activePanels(jobs, harness.store.panel, repository).filter((item) => item.queued),
      ).toEqual([
        expect.objectContaining({
          status: 'running',
          progress: 'Waiting for panels on other PRs to finish…',
        }),
      ])
    })
    await vi.waitFor(() => {
      for (const release of waiting.splice(0)) release()
      expect(activePanels(jobs, harness.store.panel, repository)).toEqual([])
    })
    expect(
      harness.store.panel
        .reviews(repository)
        .map((review) => review.number)
        .sort(),
    ).toEqual([1, 2, 3])
  })

  it('locks each PR, not the repository, and skips a PR whose panel is still working', async () => {
    const jobs = panel(hanging, { loadPull })
    const first = await jobs.start(repository, [urlFor(1)], ['unclebob'])

    const second = await jobs.start(repository, [urlFor(2)], ['unclebob'])
    const { panels, skipped } = await startEach(jobs, {
      repository,
      urls: [urlFor(1), urlFor(3)],
      reviewers: ['terminator'],
    })

    expect(second.id).not.toBe(first.id)
    expect(skipped).toEqual([
      { url: urlFor(1), reason: expect.stringMatching(/Finish or cancel/) as string },
    ])
    expect(panels.map((item) => item.url)).toEqual([urlFor(3)])
    for (const session of [first, second, ...panels])
      jobs.cancel('id' in session ? session.id : session.sessionId)
  })

  it('cancels a queued panel without running it, and lists it as stopped no more', async () => {
    const jobs = panel(hanging, { loadPull })
    const running = await jobs.start(repository, [urlFor(1)], ['unclebob'])
    await jobs.start(repository, [urlFor(2)], ['unclebob'])
    const queued = await jobs.start(repository, [urlFor(3)], ['unclebob'])
    await vi.waitFor(() => {
      expect(jobs.get(queued.id).queued).toBe(true)
    })

    const cancelled = jobs.cancel(queued.id)

    expect(cancelled).toMatchObject({ status: 'cancelled', queued: undefined })
    expect(activePanels(jobs, harness.store.panel, repository).map((item) => item.url)).toEqual(
      expect.not.arrayContaining([urlFor(3)]),
    )
    jobs.cancel(running.id)
  })
})
