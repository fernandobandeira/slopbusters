import { describe, expect, it } from 'vitest'
import type { StructuredTurnRequest } from '../../../../server/adapters/t3Engine/engineTurns'
import { runCrossLayerPass } from '../../../../server/features/stack-review/crossLayerPass'
import type { CrossLayerState, StackPassInput } from '../../../../shared/domain/stackReview'
import { companionJudge, judge } from '../../../fixtures/panelJobs'
import { emptyResult, finishedStackReview, stackEntry } from '../../../fixtures/stackReview'
import { recordingTurns } from '../../../fixtures/turns'

const input = finishedStackReview([
  stackEntry(201, 'g1'),
  stackEntry(203, 'g4', { kind: 'simplification' }),
]).input as StackPassInput

function state(secondary = true): CrossLayerState {
  return {
    roles: { primary: judge, ...(secondary ? { secondary: companionJudge } : {}) },
    turns: [],
    positions: {},
  }
}

/** A turn that says #203/g4 makes #201/g1 unnecessary, for `reason`. */
function chainReply(reason: string, approved = true) {
  return {
    ...emptyResult,
    chains: [{ cause: '#203/g4', unnecessary: ['#201/g1'], reason }],
    approved,
    summary: 'The removal upstack makes the bottom fix unnecessary.',
    objections: [],
  }
}

function pass(saved: CrossLayerState, reply: (request: StructuredTurnRequest<unknown>) => unknown) {
  const { turns, requests } = recordingTurns(reply)
  const run = runCrossLayerPass({
    turns,
    signal: new AbortController().signal,
    input,
    state: saved,
    stack: 'review-room/example #201–#203',
    save: () => {},
    track: (_pass, execute) => execute(),
  })
  return { run, requests }
}

describe('the cross-layer pass', () => {
  it('ends when both judges approve one result unchanged', async () => {
    const saved = state()
    const { run, requests } = pass(saved, () => chainReply('The job is gone.'))

    await run

    expect(requests.map((request) => request.model)).toEqual([judge, companionJudge, judge])
    expect(saved.outcome).toBe('agreed')
    expect(saved.contested).toEqual([])
    expect(requests[0]?.prompt).toContain('"id":"#203/g4"')
    expect(requests[0]?.purpose).toBe('Stack review · review-room/example #201–#203')
  })

  it('keeps the last valid result when the turns run out, marking what the other judge held differently', async () => {
    const saved = state()
    let turn = 0
    const { run, requests } = pass(saved, () => chainReply(`Reason ${String(++turn)}.`))

    await run

    expect(requests).toHaveLength(4)
    expect(saved.outcome).toBe('exhausted')
    expect(saved.result?.chains[0]?.reason).toBe('Reason 4.')
    expect(saved.contested).toEqual(['chain #203/g4'])
  })

  it('runs one turn when only one provider is available', async () => {
    const saved = state(false)
    const { run, requests } = pass(saved, () => chainReply('The job is gone.'))

    await run

    expect(requests).toHaveLength(1)
    expect(saved.outcome).toBe('single')
  })

  it('refuses a result naming an entry it was not given', async () => {
    const { run } = pass(state(), () => ({
      ...chainReply('Gone.'),
      chains: [{ cause: '#209/g1', unnecessary: ['#201/g1'], reason: 'Gone.' }],
    }))

    await expect(run).rejects.toThrow('chains: #209/g1 is not an entry you were given.')
  })

  it('resumes a saved debate with the next judge', async () => {
    const saved = state()
    await pass(saved, (request) => {
      if (saved.turns.length) throw new Error(`Interrupted at ${request.model.model}`)
      return chainReply('The job is gone.')
    }).run.catch(() => {})

    const { run, requests } = pass(saved, () => chainReply('The job is gone.'))
    await run

    expect(requests.map((request) => request.model)).toEqual([companionJudge, judge])
    expect(saved.turns).toHaveLength(3)
    expect(saved.outcome).toBe('agreed')
  })
})
