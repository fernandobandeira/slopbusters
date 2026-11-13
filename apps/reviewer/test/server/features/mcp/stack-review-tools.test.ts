import { describe, expect, it, vi } from 'vitest'
import { StackReviewTools } from '../../../../server/features/mcp/stackReviewTools'
import type { StackReviewSession } from '../../../../shared/domain/stackReview'
import { finishedStackReview, layerUrl, stackEntry } from '../../../fixtures/stackReview'

const listening = () => new AbortController().signal
const finished = finishedStackReview([stackEntry(201, 'g1')])

function toolsWith(session: StackReviewSession | undefined) {
  const jobs = {
    start: vi.fn(() => Promise.resolve(session ?? finished)),
    latest: vi.fn(() => session),
    retry: vi.fn(() => ({
      ...finished,
      status: 'running' as const,
      progress: 'Retrying the stack review…',
    })),
    cancel: vi.fn(() => ({
      ...finished,
      status: 'cancelled' as const,
      progress: 'Stack review cancelled.',
    })),
  }
  return { tools: new StackReviewTools({ jobs, pollMs: 5 }), jobs }
}

const running: StackReviewSession = {
  ...finished,
  status: 'running',
  progress: 'Running the panel on the layers without an up-to-date review…',
  input: undefined,
  pass: undefined,
  layers: finished.layers.map((layer, index) => ({
    ...layer,
    state: index ? 'reviewing' : 'reused',
  })),
}

describe('the stack review for a coding agent', () => {
  it('starts from any page of a layer and reports each layer while it works', async () => {
    const { tools, jobs } = toolsWith(running)

    const started = await tools.start(`${layerUrl(202)}/files`, ['teammate:avery'])

    expect(jobs.start).toHaveBeenCalledWith(layerUrl(202), ['teammate:avery'])
    expect(started).toBe(
      'The stack review of PR #201 to PR #203 is working. Running the panel on the layers without an up-to-date review…\n\n- PR #201 "Layer 201": Reuses its panel result, reviewed at its current head.\n- PR #202 "Layer 202": The panel is reviewing it.\n- PR #203 "Layer 203": The panel is reviewing it.\n\nCall get_stack_review with any PR of the stack to wait for the brief. Each layer\'s panel takes several minutes.',
    )
  })

  it('returns the stack brief once the review finishes', async () => {
    const { tools } = toolsWith(finished)

    const brief = await tools.read(layerUrl(203), 5, listening())

    expect(brief).toContain('# Stack review of review-room/example, PR #201 to PR #203')
    expect(brief).toContain('### PR #201: Layer 201')
    expect(brief).toContain('Plan: Fix g1.')
  })

  it('says which layer stopped it and how to continue', async () => {
    const { tools } = toolsWith({
      ...running,
      status: 'partial',
      error:
        "PR #202's panel failed: Provider unavailable. Retry the stack review to run it again.",
    })

    const read = await tools.read(layerUrl(201), 5, listening())

    expect(read).toContain(
      "The stack review of PR #201 to PR #203 stopped on some layers:\nPR #202's panel failed: Provider unavailable.",
    )
    expect(read).toContain('Call retry_stack_review to continue from there')
  })

  it('says so when no stack review covers the PR, and refuses to cancel a finished one', async () => {
    const { tools: none } = toolsWith(undefined)
    const { tools: done } = toolsWith(finished)

    await expect(none.read(layerUrl(201), 0, listening())).resolves.toBe(
      'No stack review covers PR #201. Call start_stack_review to ask for one.',
    )
    expect(() => none.retry(layerUrl(201))).toThrow('No stack review covers PR #201.')
    expect(() => done.cancel(layerUrl(201))).toThrow('No stack review is working on PR #201.')
  })
})
