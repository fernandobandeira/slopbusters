import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReviewerStore } from '../../../server/adapters/store'
import * as routes from '../../../shared/api'
import type { PanelPreparation, PanelSession } from '../../../shared/domain/panelSession'
import { Provider } from '../../../shared/domain/types'
import { fixtureJudgeAdvice, fixturePanelAdvice, fixturePanelFinding } from '../../fixtures/panel'
import { fixturePull } from '../../fixtures/pull'

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
    expect(() => routes.continuePanel.response.parse(loaded)).not.toThrow()
  })
})

const first = fixturePull()
const second = { ...first, url: first.url.replace(/\d+$/, '201'), number: 201 }
const third = { ...first, url: first.url.replace(/\d+$/, '202'), number: 202 }

function panel(id: string, overrides: Partial<PanelSession> = {}): PanelSession {
  return {
    id,
    repository: 'review-room/example',
    urls: [first.url],
    model: { provider: Provider.claude, model: 'claude-opus-5-5' },
    reviewers: [{ id: 'unclebob', name: 'Uncle Bob', maxFindings: 10 }],
    status: 'running',
    progress: 'Review in progress.',
    createdAt: '2026-10-01T00:00:00.000Z',
    results: [],
    ...overrides,
  }
}

function judged(pull: typeof first) {
  return { pull, fingerprint: 'f', advice: fixtureJudgeAdvice(), reviews: [] }
}

function paused() {
  return panel('paused', {
    status: 'cancelled',
    pending: {
      pull: first,
      fingerprint: 'f',
      reviews: [{ reviewer: 'unclebob', advice: fixturePanelAdvice() }],
    },
  })
}

const preparation: PanelPreparation = {
  snapshots: [
    { pull: first, fingerprint: 'f' },
    { pull: second, fingerprint: 'other layer' },
  ],
  layers: { [first.url]: [second.url] },
  order: { [first.url]: [first.url, second.url] },
  missing: {},
}

it('ranks newest sessions for activity and newest judged sessions for verdicts, even at equal timestamps', () => {
  const older = panel('older')
  const olderResult = panel('older-result', { status: 'complete', results: [judged(first)] })
  const complete = panel('complete', { status: 'complete', results: [judged(first)] })
  const previousVerdict = panel('previous-verdict', {
    urls: [second.url],
    status: 'complete',
    results: [judged(second)],
  })
  const partial = panel('partial', {
    urls: [second.url, third.url],
    status: 'partial',
    results: [judged(third)],
  })
  for (const session of [olderResult, older, previousVerdict, complete, partial])
    store.panel.save(session)
  store.panel.save({ ...older, progress: 'Still working.' })

  expect(store.panel.latestId(older.repository, first.url)).toBe(complete.id)
  expect(store.panel.latestId(older.repository, second.url)).toBe(partial.id)
  expect(
    store.panel.unfinished(older.repository).map(({ url, session }) => [url, session.id]),
  ).toEqual([[second.url, partial.id]])
  expect(store.panel.reviews(older.repository).map((review) => review.sessionId)).toEqual([
    partial.id,
    complete.id,
    previousVerdict.id,
  ])
  expect(store.panel.results(older.repository, first.url, 2).map(({ session }) => session)).toEqual(
    [complete.id, olderResult.id],
  )
  expect(store.panel.results(older.repository, second.url, 3)).toEqual([
    { session: previousVerdict.id, createdAt: previousVerdict.createdAt, result: judged(second) },
  ])
})

it('keeps a stopped round’s preparation across saves and drops it on completion', () => {
  const session = paused()
  store.panel.save(session)
  store.panel.savePreparation(session.id, preparation)
  store.panel.save({ ...session, status: 'running' })

  expect(store.panel.preparation(session.id)).toEqual(preparation)
  expect(store.panel.get(session.id)).not.toHaveProperty('preparation')

  store.panel.save({ ...session, status: 'complete', pending: undefined, results: [judged(first)] })

  expect(store.panel.preparation(session.id)).toBeUndefined()
})

it('upgrades v12 sessions, moving only unfinished preparation and backfilling URL lookups', () => {
  const path = join(data, 'v12')
  mkdirSync(path)
  const filename = join(path, 'reviewer.sqlite')
  const legacy = new DatabaseSync(filename)
  legacy.exec(`
    CREATE TABLE panel_sessions (
      id TEXT PRIMARY KEY, repository TEXT NOT NULL, created_at TEXT NOT NULL, session TEXT NOT NULL
    );
    CREATE INDEX panel_sessions_repository ON panel_sessions (repository, created_at);
    PRAGMA user_version = 12;
  `)
  const stopped = paused()
  const complete = panel('complete', {
    urls: [second.url],
    status: 'complete',
    results: [judged(second)],
  })
  for (const session of [complete, stopped]) {
    legacy
      .prepare('INSERT INTO panel_sessions VALUES (?, ?, ?, ?)')
      .run(
        session.id,
        session.repository,
        session.createdAt,
        JSON.stringify({ ...session, preparation }),
      )
  }
  legacy.close()

  const migrated = new ReviewerStore({ dataDirectory: path })
  try {
    expect(migrated.panel.latestId(complete.repository, second.url)).toBe(complete.id)
    expect(migrated.panel.get(complete.id)).toEqual(complete)
    expect(migrated.panel.get(stopped.id)).toEqual(stopped)
    expect(migrated.panel.preparation(complete.id)).toBeUndefined()
    expect(migrated.panel.preparation(stopped.id)).toEqual(preparation)
    expect(migrated.panel.unfinished(stopped.repository).map(({ url }) => url)).toEqual([first.url])
    expect(migrated.panel.reviews(complete.repository).map((review) => review.sessionId)).toEqual([
      complete.id,
    ])
  } finally {
    migrated.close()
  }
  const upgraded = new DatabaseSync(filename, { readOnly: true })
  try {
    expect(upgraded.prepare('PRAGMA user_version').get()?.user_version).toBe(14)
    expect(
      upgraded
        .prepare(
          "SELECT COUNT(*) AS count FROM panel_sessions WHERE json_type(session, '$.preparation') IS NOT NULL",
        )
        .get()?.count,
    ).toBe(0)
  } finally {
    upgraded.close()
  }
})
