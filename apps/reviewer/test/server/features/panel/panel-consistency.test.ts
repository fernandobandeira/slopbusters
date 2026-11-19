import { describe, expect, it, vi } from 'vitest'
import { CommandTimeoutError } from '../../../../server/adapters/process'
import type { StructuredTurnRequest } from '../../../../server/adapters/t3Engine/engineTurns'
import { consistencyReplySchema } from '../../../../shared/domain/consistency'
import type { PreviousRound } from '../../../../shared/domain/earlierRequests'
import { triage } from '../../../../shared/domain/triage'
import { groundedEntry, groundedResult, groundedSource } from '../../../fixtures/grounding'
import {
  companion,
  companionJudge,
  everyone,
  isGrounding,
  judge,
  panelHarness,
  reply,
  repository,
  url,
} from '../../../fixtures/panelJobs'
import { recordingTurns } from '../../../fixtures/turns'

const harness = panelHarness()
const loadPull = () => Promise.resolve(groundedResult([], { candidates: [] }).pull)

const isCheck = (request: StructuredTurnRequest<unknown>) =>
  Boolean(request.purpose?.startsWith('Panel consistency check'))
const earlierNote = 'What earlier rounds of this panel asked for on this PR'

/** The round before: one fix that read the card inside the bill query. */
const previous: PreviousRound = {
  result: groundedResult(
    [groundedEntry('g4', 'f1', { plan: 'Read the card in the bill query.' })],
    {
      candidates: [groundedSource('f1', 'Read the card with the payment')],
    },
  ),
  createdAt: '2026-11-18T09:30:00.000Z',
}
const reversal = {
  reversals: [{ entry: 'g1', earlier: 'e1', reason: 'It moves the card read back out.' }],
  conflicts: [],
}
const checked = (request: StructuredTurnRequest<unknown>) =>
  isCheck(request) ? reversal : reply(request)

function panel(turns: Parameters<typeof harness.panel>[0], round?: PreviousRound) {
  return harness.panel(turns, { loadPull, previousRound: () => round })
}

async function finished(jobs: ReturnType<typeof panel>, id: string, status = 'complete') {
  await vi.waitFor(() => {
    expect(jobs.get(id).status).toBe(status)
  })
  return jobs.get(id)
}

describe('grounding reads what earlier rounds asked for', () => {
  it('gives grounding the requests after the reviewers, and the seats nothing of them', async () => {
    const { turns, requests } = recordingTurns(checked)
    const jobs = panel(turns, previous)

    const session = await finished(jobs, (await jobs.start(repository, [url], everyone)).id)

    const grounding = requests.filter(isGrounding)
    expect(grounding[0]?.prompt).toContain(earlierNote)
    expect(grounding[0]?.prompt).toContain('"key":"e1"')
    expect(grounding[0]?.prompt).toContain('Read the card in the bill query.')
    const seats = requests.filter((request) => !isGrounding(request) && !isCheck(request))
    expect(seats.length).toBeGreaterThan(0)
    expect(seats.every((request) => !request.prompt.includes(earlierNote))).toBe(true)
    expect(session.results[0]?.grounding?.earlier?.requests.map((item) => item.entry)).toEqual([
      'g4',
    ])
  })

  it('keeps the requests it started with when a stopped debate resumes', async () => {
    let fail = true
    const { turns, requests } = recordingTurns((request) => {
      if (isGrounding(request) && request.model.provider === companion.provider && fail)
        throw new Error('Codex stopped')
      return checked(request)
    })
    let round: PreviousRound | undefined = previous
    const jobs = harness.panel(turns, { loadPull, previousRound: () => round })
    const started = await jobs.start(repository, [url], everyone)
    await finished(jobs, started.id, 'failed')
    fail = false
    round = undefined
    const before = requests.length

    jobs.retry(started.id)
    const session = await finished(jobs, started.id)

    const resumed = requests.slice(before).filter(isGrounding)
    expect(resumed[0]?.prompt).toContain('"key":"e1"')
    expect(session.results[0]?.grounding?.earlier?.requests).toHaveLength(1)
  })
})

describe('the consistency check after the debate', () => {
  it('runs once on the Codex judge and marks the entry that would undo an earlier fix', async () => {
    const { turns, requests } = recordingTurns(checked)
    const jobs = panel(turns, previous)

    const session = await finished(jobs, (await jobs.start(repository, [url], everyone)).id)

    const checks = requests.filter(isCheck)
    expect(checks.map((request) => request.model)).toEqual([companionJudge])
    expect(checks[0]?.directory).toBeUndefined()
    expect(checks[0]?.timeoutMs).toBe(10 * 60 * 1000)
    expect(checks[0]?.prompt).toContain('"plan":"Reuse the audit helper."')
    const [entry] = session.results[0]?.grounding?.resolved ?? []
    expect(entry?.reverses).toEqual({ earlier: 'e1', reason: 'It moves the card read back out.' })
    expect(entry && triage(entry)).toMatchObject({
      disposition: 'ask',
      reason: 'Would undo a change an earlier round asked for.',
    })
  })

  it('runs on the primary judge when no judge is on Codex', async () => {
    const { turns, requests } = recordingTurns(checked)
    const jobs = harness.panel(turns, {
      loadPull,
      previousRound: () => previous,
      judges: () => ({ primary: judge }),
    })

    await finished(jobs, (await jobs.start(repository, [url], everyone)).id)

    expect(requests.filter(isCheck).map((request) => request.model)).toEqual([judge])
  })

  it('is skipped when there is nothing to compare', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = panel(turns)

    const session = await finished(jobs, (await jobs.start(repository, [url], everyone)).id)

    expect(requests.filter(isCheck)).toHaveLength(0)
    expect(session.results[0]?.grounding?.consistency).toEqual({ reversals: [], conflicts: [] })
  })
})

describe('a consistency check that stops', () => {
  it('stops the round when it fails, and a retry runs only the check again', async () => {
    let fail = true
    const { turns, requests } = recordingTurns((request) => {
      if (isCheck(request) && fail) throw new Error('Codex stopped')
      return checked(request)
    })
    const jobs = panel(turns, previous)
    const started = await jobs.start(repository, [url], everyone)

    const stopped = await finished(jobs, started.id, 'failed')
    fail = false
    const before = requests.length
    jobs.retry(started.id)
    const session = await finished(jobs, started.id)

    expect(stopped.error).toBe(
      'The consistency check on gpt-6.2-astra failed. Retry continues from there.',
    )
    expect(requests.slice(before).map(isCheck)).toEqual([true])
    expect(session.results[0]?.grounding?.resolved?.[0]?.reverses?.earlier).toBe('e1')
  })

  it('says when it ran out of time', async () => {
    const { turns } = recordingTurns((request) => {
      if (isCheck(request)) throw new CommandTimeoutError('Codex')
      return checked(request)
    })
    const jobs = panel(turns, previous)

    const stopped = await finished(
      jobs,
      (await jobs.start(repository, [url], everyone)).id,
      'failed',
    )

    expect(stopped.error).toBe(
      'The consistency check on gpt-6.2-astra ran out of time after 10 minutes. Retry continues from there.',
    )
  })

  it('is not run again once its result is saved', async () => {
    const { turns, requests } = recordingTurns(checked)
    const jobs = panel(turns, previous)
    const started = await jobs.start(repository, [url], everyone)
    const first = await finished(jobs, started.id)
    const saved = first.results[0]?.grounding
    if (!saved) throw new Error('Missing grounding.')
    harness.store.panel.save({
      ...first,
      status: 'failed',
      results: [],
      pending: { ...first.results[0]!, grounding: saved },
    })
    const before = requests.length

    jobs.retry(started.id)
    await finished(jobs, started.id)

    expect(
      requests.slice(before).filter((request) => isCheck(request) || isGrounding(request)),
    ).toEqual([])
  })

  it('refuses a reply that names an entry or request it was not given, or one twice', () => {
    const schema = consistencyReplySchema({ entries: ['g1', 'g2'], earlier: ['e1'] })

    const parsed = schema.safeParse({
      reversals: [
        { entry: 'g7', earlier: 'e1', reason: 'Undoes it.' },
        { entry: 'g1', earlier: 'e9', reason: 'Undoes it.' },
      ],
      conflicts: [{ entries: ['g1', 'g2', 'g1'], reason: 'Opposite.' }],
    })

    expect(parsed.error?.issues.map((issue) => issue.message)).toEqual([
      'reversals: g7 is not an entry you were given.',
      'reversals: e9 is not an earlier request you were given.',
      'conflicts: g1 is named more than once.',
    ])
    expect(schema.safeParse({ reversals: [], conflicts: [] }).success).toBe(true)
  })
})
