import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReviewerStore } from '../server/adapters/store'
import * as routes from '../shared/api'
import type { PanelSession } from '../shared/domain/panel'
import { Provider } from '../shared/domain/types'
import { fixtureJudgeAdvice, fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
import { fixturePull } from './fixtures/pull'

let data: string
let store: ReviewerStore

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'panel-store-'))
  store = new ReviewerStore({ dataDirectory: data })
})
afterEach(() => {
  store.close()
  rmSync(data, { recursive: true, force: true })
})

describe('a panel session saved before anchors', () => {
  it('reads back with each finding anchored on the changed line it named', () => {
    const finding = fixturePanelFinding()
    if (finding.anchor.kind !== 'change') throw new Error('The fixture is on a changed line.')
    const { anchor, ...rest } = finding
    const { kind: _kind, ...flat } = anchor
    const legacyFinding = { ...rest, ...flat }
    const judged = fixtureJudgeAdvice()
    const pull = fixturePull()
    const legacy = {
      id: 'legacy',
      repository: 'review-room/example',
      urls: [pull.url],
      model: { provider: Provider.claude, model: 'claude-opus-5-5' },
      reviewers: [{ id: 'unclebob', name: 'Uncle Bob', maxFindings: 10 }],
      status: 'complete',
      progress: 'Done.',
      createdAt: '2026-10-01T00:00:00.000Z',
      results: [
        {
          pull,
          fingerprint: 'f',
          advice: { ...judged, findings: [{ ...legacyFinding, raisedBy: ['unclebob'] }] },
          reviews: [
            {
              reviewer: 'unclebob',
              advice: { ...fixturePanelAdvice(), findings: [legacyFinding] },
            },
          ],
        },
      ],
    } as unknown as PanelSession
    store.panel.save(legacy)

    const loaded = store.panel.get('legacy')

    expect(loaded?.results[0]?.advice.findings[0]?.anchor).toEqual(anchor)
    expect(loaded?.results[0]?.reviews[0]?.advice?.findings[0]?.anchor).toEqual(anchor)
    expect(() => routes.getPanel.response.parse(loaded)).not.toThrow()
  })
})
