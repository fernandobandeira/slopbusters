import { describe, expect, it, vi } from 'vitest'
import type { StructuredTurnRequest } from '../../../../server/adapters/t3Engine/engineTurns'
import { PanelGates } from '../../../../server/features/panel/panelGates'
import { everyone, judge, panelHarness, reply, repository, url } from '../../../fixtures/panelJobs'
import { recordingTurns } from '../../../fixtures/turns'

const harness = panelHarness()

const planning = (request: StructuredTurnRequest<unknown>) =>
  Boolean(request.purpose?.startsWith('Panel plan'))

async function reviewed() {
  const { turns, requests } = recordingTurns((request) =>
    planning(request) ? { plan: 'Call writeAudit from the handler.' } : reply(request),
  )
  const jobs = harness.panel(turns)
  const session = await jobs.start(repository, [url], everyone)
  await vi.waitFor(() => {
    expect(jobs.get(session.id).status).toBe('complete')
  })
  const gates = new PanelGates({
    store: harness.store.panel,
    turns,
    judges: () => ({ primary: judge }),
  })
  return { id: session.id, gates, requests }
}

describe('choosing fixes on a reviewed PR', () => {
  it('saves the author’s choices and refuses ones for findings the review does not have', async () => {
    const { id, gates } = await reviewed()

    expect(() => gates.save(id, url, { actions: [{ entry: 'g7', selected: true }] })).toThrow(
      /do not match the grounded findings/,
    )
    gates.save(id, url, {
      actions: [{ entry: 'g1', selected: true, plan: 'Inline it.', planBy: 'author' }],
    })

    expect(harness.store.panel.get(id)?.results[0]?.gate?.actions).toEqual([
      { entry: 'g1', selected: true, plan: 'Inline it.', planBy: 'author' },
    ])
    expect(harness.store.panel.get(id)?.results[0]?.grounding?.resolved?.[0]?.plan).toBe(
      'Reuse the audit helper.',
    )
  })

  it('asks the grounding model for a plan and records who wrote it', async () => {
    const { id, gates, requests } = await reviewed()

    const session = await gates.plan(id, url, 'g1')

    const request = requests.find(planning)
    expect(request?.model).toEqual(judge)
    expect(request?.prompt).toContain('"id":"g1"')
    expect(session.results[0]?.gate?.actions).toEqual([
      { entry: 'g1', selected: true, plan: 'Call writeAudit from the handler.', planBy: 'planner' },
    ])
  })
})
