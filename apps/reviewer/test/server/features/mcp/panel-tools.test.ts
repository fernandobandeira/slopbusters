import { describe, expect, it, vi } from 'vitest'
import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../../../../server/adapters/t3Engine/engineTurns'
import { PanelTools } from '../../../../server/features/mcp/panelTools'
import { panelHarness, reply, repository, url } from '../../../fixtures/panelJobs'
import { recordingTurns } from '../../../fixtures/turns'

const harness = panelHarness()
const toolsFor = (turns: StructuredTurns) =>
  new PanelTools({ jobs: harness.panel(turns), teammates: harness.teammates, pollMs: 5 })
const listening = () => new AbortController().signal

/** A turn that runs until its panel is cancelled. */
const hanging: StructuredTurns = {
  run: ({ signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(new Error('Cancelled'))
      })
    }),
}

describe('the panel for a coding agent', () => {
  it('starts a panel on any page of a PR and waits for its review as a brief', async () => {
    const tools = toolsFor(recordingTurns(reply).turns)

    const started = await tools.start(`${url}/files`)
    const review = await tools.read(url, 5, listening())

    expect(started).toContain('The panel is reviewing PR #128 (Uncle Bob, Terminator).')
    expect(started).toContain('Call get_panel_review')
    expect(harness.jobs?.latest(repository, url)?.urls).toEqual([url])
    expect(review).toContain('The author has not chosen fixes in Slopbusters yet.')
    expect(review).toContain('## The fixes the author chose')
    expect(review).toContain('Plan: Reuse the audit helper.')
  })

  it('asks the reviewers the agent names', async () => {
    const tools = toolsFor(hanging)

    const started = await tools.start(url, ['teammate:avery'])

    expect(started).toContain('The panel is reviewing PR #128 (Avery).')
  })

  it("returns the panel's progress when the wait ends first", async () => {
    const tools = toolsFor(hanging)
    await tools.start(url)

    const waited = await tools.read(url, 0, listening())

    expect(waited).toContain('The panel is reviewing PR #128')
    expect(waited).toContain('Call get_panel_review')
  })

  it('stops waiting when the agent hangs up', async () => {
    const tools = toolsFor(hanging)
    await tools.start(url)
    const agent = new AbortController()

    const waiting = tools.read(url, 600, agent.signal)
    agent.abort()

    await expect(waiting).resolves.toContain('The panel is reviewing PR #128')
  })

  it('says so when no panel has reviewed the PR', async () => {
    const tools = toolsFor(hanging)

    await expect(tools.read(url, 5, listening())).resolves.toBe(
      'No panel has reviewed PR #128. Call start_panel_review to ask for one.',
    )
    expect(() => tools.cancel(url)).toThrow('No panel has reviewed PR #128.')
  })

  it('grounds the finished reviews when asked to skip a reviewer that failed', async () => {
    const turns: StructuredTurns = {
      run: <T>(request: StructuredTurnRequest<T>) =>
        request.purpose?.startsWith('Terminator')
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(request.schema.parse(reply(request))),
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const tools = toolsFor(turns)
    await tools.start(url)

    const stopped = await tools.read(url, 5, listening())
    tools.retry(url, true)
    const review = await tools.read(url, 5, listening())

    expect(stopped).toContain('some reviewers could not finish:\nTerminator: Terminator failed.')
    expect(stopped).toContain('skip_failed_reviewers')
    expect(review).toContain('Plan: Reuse the audit helper.')
    expect(() => tools.retry(url, false)).toThrow('The panel already reviewed PR #128.')
  })

  it('cancels the panel working on a PR, then runs it again on a retry', async () => {
    const tools = toolsFor(hanging)
    await tools.start(url)

    const cancelled = tools.cancel(url)

    expect(cancelled).toContain(
      'The panel review of PR #128 did not finish. Panel review cancelled.',
    )
    expect(cancelled).toContain('Call retry_panel_review')
    expect(() => tools.cancel(url)).toThrow('No panel is working on PR #128.')
    // The cancelled job ends a moment after the cancel returns.
    await vi.waitFor(() => {
      expect(tools.retry(url, false)).toContain('The panel is reviewing PR #128')
    })
  })

  it('lists the built-in reviewers and teammates with the ids to ask them by', async () => {
    const reviewers = await toolsFor(hanging).reviewers()

    expect(reviewers).toContain('- `unclebob`: Uncle Bob. Clean code')
    expect(reviewers).toContain('- `terminator`: Terminator. Repository rules')
    expect(reviewers).toContain('- `teammate:avery`: Avery.')
    expect(reviewers).toContain('the AveryReview skill (Claude only)')
    expect(reviewers).toContain('Without a choice, a panel is Uncle Bob and Terminator.')
  })
})
