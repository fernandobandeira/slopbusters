import { describe, expect, it, vi } from 'vitest'
import { CommandTimeoutError } from '../../../../server/adapters/process'
import type { StructuredTurnRequest } from '../../../../server/adapters/t3Engine/engineTurns'
import { fixturePanelAdvice, fixturePanelFinding } from '../../../fixtures/panel'
import {
  companion,
  companionJudge,
  everyone,
  groundingReply,
  isGrounding,
  judge,
  panelHarness,
  reply,
  repository,
  url,
} from '../../../fixtures/panelJobs'
import { fixturePull } from '../../../fixtures/pull'
import { installSkill } from '../../../fixtures/skills'
import { recordingTurns } from '../../../fixtures/turns'

const harness = panelHarness()
const panel = harness.panel

const many = (count: number) =>
  fixturePanelAdvice(
    Array.from({ length: count }, (_, index) =>
      fixturePanelFinding({ id: `finding-${String(index)}` }),
    ),
  )

describe('a round with more findings than it can ground', () => {
  it('grounds forty across the seats and keeps the rest visible as deferred', async () => {
    await harness.teammates.create({
      name: 'Quinn',
      skill: installSkill(harness.roots.claude, 'QuinnReview').split('/').pop() ?? '',
      maxFindings: 40,
    })
    const { turns, requests } = recordingTurns((request) =>
      request.purpose?.startsWith('Quinn') ? many(40) : reply(request),
    )
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], [...everyone, 'teammate:quinn'])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const [result] = jobs.get(session.id).results
    const states = result?.grounding?.candidates.map((candidate) => candidate.state)
    expect(states?.filter((state) => state === 'selected')).toHaveLength(40)
    expect(states?.filter((state) => state === 'deferred')).toHaveLength(3)
    expect(requests.find(isGrounding)?.prompt).not.toContain('"key":"f41"')
    expect(result?.advice.limitations).toContain(
      'The reviewers returned 43 findings; this round grounded 40 and deferred 3 to a later round. Deferred findings are not rejected.',
    )
  })
})

describe('a grounding debate that does not settle', () => {
  it('saves the last valid list after six turns, with the dispute kept', async () => {
    const { turns, requests } = recordingTurns((request) => {
      if (!isGrounding(request)) return reply(request)
      const turn = groundingReply(request)
      return request.model.provider === companion.provider
        ? { ...turn, approved: false, objections: [{ entry: 'g1', objection: 'Not shown.' }] }
        : turn
    })
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    expect(requests.filter(isGrounding)).toHaveLength(6)
    const [result] = jobs.get(session.id).results
    expect(result?.grounding?.outcome).toBe('exhausted')
    expect(result?.grounding?.resolved?.map((entry) => entry.resolution)).toEqual(['disputed'])
    expect(result?.advice.verdict).toBe('changes')
    expect(result?.advice.disagreements[0]).toMatch(/objected: Not shown\./)
  })

  it('leaves every entry unverified when only one provider is available', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = panel(turns, {
      loadPull: () => Promise.resolve(fixturePull()),
      judges: () => ({ primary: judge }),
    })

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    expect(requests.filter(isGrounding).map((request) => request.model)).toEqual([judge])
    const [result] = jobs.get(session.id).results
    expect(result?.grounding?.outcome).toBe('single')
    expect(result?.grounding?.resolved?.map((entry) => entry.resolution)).toEqual(['unverified'])
    expect(result?.advice.limitations.join(' ')).toMatch(/no finding was checked by a second model/)
  })
})

describe('a grounding debate that stops', () => {
  it('resumes from the last valid turn after a provider fails, without rerunning seats', async () => {
    let fail = true
    const { turns, requests } = recordingTurns((request) => {
      if (isGrounding(request) && request.model.provider === companion.provider && fail)
        throw new Error('Codex stopped')
      return reply(request)
    })
    const jobs = panel(turns)
    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('failed')
    })
    expect(jobs.get(session.id).pending?.grounding?.turns).toHaveLength(1)
    fail = false
    const before = requests.length

    jobs.retry(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const after = requests.slice(before)
    expect(after.every(isGrounding)).toBe(true)
    expect(after.map((request) => request.model)).toEqual([companionJudge, judge])
    expect(after[0]?.prompt).toContain('The current list:')
    expect(jobs.get(session.id).results[0]?.grounding?.outcome).toBe('agreed')
  })

  it('says a turn ran out of time, with room for a long turn, and keeps what came before', async () => {
    const { turns, requests } = recordingTurns((request) => {
      if (isGrounding(request) && request.model.provider === companion.provider)
        throw new CommandTimeoutError('Codex')
      return reply(request)
    })
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('failed')
    })

    expect(jobs.get(session.id).error).toBe(
      'Grounding turn 2 on gpt-6-astra ran out of time after 20 minutes. Retry continues from the last finished turn.',
    )
    expect(requests.find(isGrounding)?.timeoutMs).toBe(20 * 60 * 1000)
    expect(jobs.get(session.id).pending?.grounding?.turns).toHaveLength(1)
  })

  it('keeps the debate when the app stops, so a retry after restart resumes it', async () => {
    const stalled = (request: StructuredTurnRequest<unknown>) =>
      new Promise<never>((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new Error('aborted'))
        })
      })
    const first = recordingTurns(reply)
    const jobs = panel({
      run: async (request) =>
        isGrounding(request) && request.model.provider === companion.provider
          ? stalled(request)
          : first.turns.run(request),
    })
    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).pending?.grounding?.turns).toHaveLength(1)
    })

    await jobs.close()
    const { turns, requests } = recordingTurns(reply)
    const restarted = panel(turns)
    expect(restarted.get(session.id).status).toBe('cancelled')
    restarted.retry(session.id)
    await vi.waitFor(() => {
      expect(restarted.get(session.id).status).toBe('complete')
    })

    expect(requests.map((request) => request.model)).toEqual([companionJudge, judge])
  })
})
