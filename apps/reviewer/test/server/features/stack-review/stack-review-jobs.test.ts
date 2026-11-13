import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../../../../server/adapters/t3Engine/engineTurns'
import { StackReviewJobs } from '../../../../server/features/stack-review/stackReviewJobs'
import { parsePullUrl } from '../../../../shared/domain/pullUrl'
import { stackBrief } from '../../../../shared/domain/stackBrief'
import { fixturePanelAdvice } from '../../../fixtures/panel'
import {
  companionJudge,
  groundingReply,
  isGrounding,
  judge,
  panelHarness,
} from '../../../fixtures/panelJobs'
import { fixturePull } from '../../../fixtures/pull'
import { emptyResult, layerUrl } from '../../../fixtures/stackReview'
import { recordingTurns } from '../../../fixtures/turns'

const harness = panelHarness()
const numbers = [201, 202, 203]
let heads: Map<number, string>
let stackJobs: StackReviewJobs | undefined
beforeEach(() => {
  heads = new Map(numbers.map((number) => [number, `head-${String(number)}`]))
})
afterEach(async () => {
  await stackJobs?.close()
  stackJobs = undefined
})

const numberOf = (url: string) => parsePullUrl(url).number
const pullAt = (url: string) => ({
  ...fixturePull(),
  id: `pull-${String(numberOf(url))}-${heads.get(numberOf(url)) ?? ''}`,
  url,
  number: numberOf(url),
  headSha: heads.get(numberOf(url)) ?? '',
  baseSha: 'base',
})
const layerOf = (request: StructuredTurnRequest<unknown>) =>
  Number(/#(\d+)$/.exec(request.purpose ?? '')?.[1])
const isCrossLayer = (request: StructuredTurnRequest<unknown>) =>
  Boolean(request.purpose?.startsWith('Stack review'))
const seatTurns = (requests: StructuredTurnRequest<unknown>[], layer: number) =>
  requests.filter(
    (request) => request.purpose?.includes(' on the panel · ') && layerOf(request) === layer,
  )

/** Seats review, grounding keeps every finding on its own layer, and the pass finds nothing more. */
function reply(request: StructuredTurnRequest<unknown>) {
  if (isCrossLayer(request))
    return { ...emptyResult, approved: true, summary: 'Nothing repeats.', objections: [] }
  if (!isGrounding(request)) return fixturePanelAdvice()
  const grounded = groundingReply(request)
  return {
    ...grounded,
    entries: grounded.entries.map((entry) => ({
      ...entry,
      destination: { kind: 'code', pull: layerOf(request) },
    })),
  }
}

function stackReview(turns: StructuredTurns) {
  const panels = harness.panel(turns, { loadPull: (url) => Promise.resolve(pullAt(url)) })
  stackJobs = new StackReviewJobs({
    store: harness.store.stackReview,
    turns,
    panels,
    results: (repository, url) => harness.store.panel.results(repository, url, 3),
    resolve: () =>
      Promise.resolve(
        numbers.map((number) => ({
          url: layerUrl(number),
          number,
          title: `Layer ${String(number)}`,
        })),
      ),
    revision: (url) =>
      Promise.resolve({ headSha: heads.get(numberOf(url)) ?? '', baseSha: 'base' }),
    judges: () => ({ primary: judge, companion: companionJudge }),
    pollMs: 5,
  })
  return stackJobs
}

async function settled(jobs: StackReviewJobs, id: string) {
  await vi.waitFor(
    () => {
      expect(jobs.get(id).status).not.toBe('running')
    },
    { timeout: 5000, interval: 10 },
  )
  return jobs.get(id)
}

async function panelOn(number: number) {
  const panels = harness.jobs
  if (!panels) throw new Error('Build the stack review first.')
  const panel = await panels.start('review-room/example', [layerUrl(number)], ['unclebob'])
  await vi.waitFor(() => {
    expect(panels.get(panel.id).status).toBe('complete')
  })
}

describe('a whole-stack review', () => {
  it('runs the panel on every layer, then the cross-layer pass, and saves the brief', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = stackReview(turns)

    const started = await jobs.start(`${layerUrl(202)}/files`)
    const session = await settled(jobs, started.id)

    expect(session.status).toBe('complete')
    expect(session.url).toBe(layerUrl(202))
    expect(session.reviewers).toEqual(['unclebob', 'terminator'])
    expect(session.layers.map((layer) => layer.state)).toEqual(['reviewed', 'reviewed', 'reviewed'])
    expect(requests.filter(isCrossLayer).map((request) => request.model)).toEqual([
      judge,
      companionJudge,
      judge,
    ])
    expect(session.input?.entries.map((entry) => entry.id)).toEqual([
      '#201/g1',
      '#202/g1',
      '#203/g1',
    ])
    expect(stackBrief(session)?.fixes.map((group) => group.layer.number)).toEqual(numbers)
  })

  it('reuses a result reviewed at the current head and reruns one whose layer moved', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = stackReview(turns)
    await panelOn(201)
    await panelOn(202)
    heads.set(202, 'moved')
    const before = requests.length

    const session = await settled(jobs, (await jobs.start(layerUrl(201))).id)
    const during = requests.slice(before)

    expect(session.layers.map((layer) => layer.state)).toEqual(['reused', 'reviewed', 'reviewed'])
    expect(session.reviewers).toEqual([{ id: 'unclebob', providers: ['claude'] }])
    expect(seatTurns(during, 201)).toHaveLength(0)
    expect(seatTurns(during, 202)).toHaveLength(1)
    expect(session.input?.entries.map((entry) => entry.id)).toContain('#202/earlier/g1')
  })

  it('stops partial on a layer waiting on the author, and a retry continues from there', async () => {
    let failing = true
    const { turns, requests } = recordingTurns((request) => {
      if (failing && request.purpose === 'Uncle Bob on the panel · review-room/example#202')
        throw new Error('Provider unavailable.')
      return reply(request)
    })
    const jobs = stackReview(turns)
    const started = await jobs.start(layerUrl(201))

    const stopped = await settled(jobs, started.id)
    failing = false
    const before = requests.length
    const retried = await settled(jobs, jobs.retry(started.id).id)
    const during = requests.slice(before)

    expect(stopped.status).toBe('partial')
    expect(stopped.progress).toBe('PR #202 stopped the stack review. Retry continues from there.')
    expect(stopped.error).toContain(
      "PR #202's panel is waiting on you: Uncle Bob: Uncle Bob failed.",
    )
    expect(retried.status).toBe('complete')
    expect(retried.layers.map((layer) => layer.state)).toEqual(['reused', 'reviewed', 'reused'])
    expect(seatTurns(during, 202).map((request) => request.purpose)).toEqual([
      'Uncle Bob on the panel · review-room/example#202',
    ])
    expect([...seatTurns(during, 201), ...seatTurns(during, 203)]).toEqual([])
  })
})

describe('stopping a stack review', () => {
  it('runs one stack review per stack, and cancels it without losing panel results', async () => {
    const hanging: StructuredTurns = {
      run: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('Cancelled'))
          })
        }),
    }
    const jobs = stackReview(hanging)
    const first = await jobs.start(layerUrl(201))

    const again = await jobs.start(layerUrl(203))
    const cancelled = jobs.cancel(first.id)

    expect(again.id).toBe(first.id)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.progress).toBe(
      'Stack review cancelled. Panels it started keep working; retry reuses their results.',
    )
    expect(harness.store.stackReview.get(first.id)?.status).toBe('cancelled')
  })
})
