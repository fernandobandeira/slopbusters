import { describe, expect, it, vi } from 'vitest'
import type { StructuredTurnRequest } from '../server/adapters/t3Engine/engineTurns'
import { PanelRoutes } from '../server/features/panel/panelRoutes'
import type { ResolvedEntry } from '../shared/domain/grounding'
import type { PanelSession } from '../shared/domain/panelSession'
import { everyone, judge, panelHarness, reply, repository, url } from './fixtures/panelJobs'
import { fixturePanelFinding } from './fixtures/panel'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

const harness = panelHarness()
const pull = fixturePull()
const drafting = (request: StructuredTurnRequest<unknown>) =>
  Boolean(request.purpose?.startsWith('Panel description draft'))

/** A reviewed PR whose one grounded finding belongs where `destination` says. */
async function reviewed(destination: ResolvedEntry['destination']) {
  const { turns, requests } = recordingTurns((request) =>
    drafting(request) ? { text: 'Adds the audit row through writeAudit.' } : reply(request),
  )
  const jobs = harness.panel(turns)
  const session = await jobs.start(repository, [url], everyone)
  await vi.waitFor(() => {
    expect(jobs.get(session.id).status).toBe('complete')
  })
  const saved = harness.store.panel.get(session.id) as PanelSession
  const entry = saved.results[0]?.grounding?.resolved?.[0]
  if (entry) entry.destination = destination
  harness.store.panel.save(saved)
  const start = vi.fn().mockResolvedValue({ id: 'layer-round' })
  const routes = new PanelRoutes({
    store: harness.store.panel,
    turns,
    jobs: { start },
    judges: () => ({ primary: judge }),
  })
  return { id: session.id, jobs, routes, start, requests }
}

describe('a finding that belongs on another layer', () => {
  it('starts one round there with the same panel, carrying the reviewers’ findings', async () => {
    const { id, routes, start } = await reviewed({ kind: 'code', pull: 13 })

    await routes.toLayer(id, url, 13)
    const session = await routes.toLayer(id, url, 13)

    expect(start).toHaveBeenCalledTimes(1)
    const [startedIn, urls, seats, carried] = start.mock.calls[0] as unknown[]
    expect(startedIn).toBe(repository)
    expect(urls).toEqual(['https://github.com/review-room/example/pull/13'])
    expect(seats).toEqual(expect.arrayContaining([{ id: 'unclebob', providers: ['claude'] }]))
    expect(carried).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://github.com/review-room/example/pull/13',
          from: { pull: pull.number, entry: 'g1' },
        }),
      ]),
    )
    expect(session.results[0]?.routed).toEqual([
      expect.objectContaining({ pull: 13, session: 'layer-round', entries: ['g1'] }),
    ])
  })

  it('is grounded in that round beside its own reviewers’ findings', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = harness.panel(turns)
    const carried = {
      url,
      from: { pull: 12, entry: 'g4' },
      seat: 'unclebob',
      finding: fixturePanelFinding({ id: 'sent' }),
    }

    const session = await jobs.start(repository, [url], everyone, [carried])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const candidates = jobs.get(session.id).results[0]?.grounding?.candidates ?? []
    expect(candidates.at(-1)).toMatchObject({
      state: 'selected',
      carriedFrom: { pull: 12, entry: 'g4' },
    })
    expect(requests.some((request) => request.prompt.includes('"carriedFrom":"PR #12"'))).toBe(true)
  })
})

describe('a change to the PR description', () => {
  it('becomes a draft of the whole new description, written from the current one', async () => {
    const { id, routes, requests } = await reviewed({
      kind: 'metadata',
      pull: pull.number,
      field: 'description',
    })

    const session = await routes.draftMetadata(id, url, 'description')

    expect(requests.find(drafting)?.prompt).toContain(JSON.stringify(pull.description))
    expect(session.results[0]?.metadataDrafts).toEqual([
      expect.objectContaining({
        field: 'description',
        text: 'Adds the audit row through writeAudit.',
        entries: ['g1'],
      }),
    ])
    await expect(routes.draftMetadata(id, url, 'title')).rejects.toThrow(/No ready change/)
  })
})
