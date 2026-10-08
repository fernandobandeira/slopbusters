import { required } from './fixtures/bob'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ReviewerStore } from '../server/adapters/store'
import { emptyDraft, legacyHunkFingerprint, pullIdentity } from '../server/features/progress'
import { sectionedPull } from '../shared/domain/changeSections'
import { parseFile } from '../server/features/diff'
import { sectionPull } from './fixtures/sections'

const directories: string[] = []
const stores: ReviewerStore[] = []
function directory() {
  const path = mkdtempSync(join(tmpdir(), 'review-updates-'))
  directories.push(path)
  return path
}
function open(path: string) {
  const store = new ReviewerStore({ dataDirectory: path })
  stores.push(store)
  return store
}
function close(store: ReviewerStore) {
  store.close()
  stores.splice(stores.indexOf(store), 1)
}
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
const base = 'function first() {\n  return 1\n}\n\nfunction second() {\n  return 2\n}\n'

function seedLegacyEvidence(
  path: string,
  previous: ReturnType<typeof sectionPull>,
  legacy: ReturnType<typeof parseFile>,
) {
  const database = new DatabaseSync(join(path, 'reviewer.sqlite'))
  database.prepare('INSERT INTO drafts (snapshot_id, draft) VALUES (?, ?)').run(
    previous.id,
    JSON.stringify({
      ...emptyDraft(),
      viewedHunkIds: ['legacy-hunk'],
      summary: 'Preserve my review',
    }),
  )
  database
    .prepare('INSERT INTO reviewed_hunks (pull_identity, fingerprint) VALUES (?, ?)')
    .run(pullIdentity(previous), legacyHunkFingerprint(legacy, required(legacy.hunks[0])))
  database.exec('DROP TABLE review_baselines; PRAGMA user_version = 5;')
  database.close()
}

describe('durable review updates', () => {
  it('pins the previous saved review through new edits, regrouping and restart', () => {
    const path = directory()
    let store = open(path)
    const previous = sectionPull(base, base.replace('return 1', 'return 10'))
    store.savePull(previous)
    store.saveDraft(previous.id, {
      ...emptyDraft(),
      viewedFileIds: [required(previous.files[0]).id],
    })
    const current = {
      ...sectionPull(base, base.replace('return 1', 'return 10').replace('return 2', 'return 20')),
      id: 'current',
      headSha: 'current-head',
    }
    store.savePull(current)
    const initial = store.getDraft(current.id)
    expect(initial.draft.viewedHunkIds).toEqual([required(required(current.files[0]).hunks[0]).id])
    expect(initial.changes).toMatchObject({
      baselineHeadSha: previous.headSha,
      sections: [{ hunkId: required(required(current.files[0]).hunks[1]).id, state: 'new' }],
    })
    store.saveDraft(current.id, {
      ...initial.draft,
      viewedFileIds: [required(current.files[0]).id],
      viewedHunkIds: required(current.groups[0]).hunkIds,
    })
    store.savePull({
      ...current,
      groups: current.groups.map((group) => ({ ...group, id: 'regrouped', title: 'A new title' })),
    })
    close(store)
    store = open(path)
    expect(store.getDraft(current.id).changes).toEqual(initial.changes)
    expect(store.getDraft(current.id).draft.viewedFileIds).toEqual([required(current.files[0]).id])
    const next = { ...current, id: 'next', headSha: 'next-head' }
    store.savePull(next)
    expect(store.getDraft(next.id).changes).toMatchObject({
      baselineHeadSha: current.headSha,
      sections: [],
      removed: [],
    })
  })

  it('forgets dismissed updates for this revision only', () => {
    const path = directory()
    let store = open(path)
    const previous = sectionPull(base, base.replace('return 1', 'return 10'))
    store.savePull(previous)
    store.saveDraft(previous.id, emptyDraft())
    const current = {
      ...sectionPull(base, base.replace('return 2', 'return 20')),
      id: 'current',
      headSha: 'current-head',
    }
    store.savePull(current)
    expect(store.getDraft(current.id).changes).toBeDefined()
    expect(store.dismissChanges(current.id)).toEqual({ ok: true })
    expect(store.getDraft(current.id).changes).toBeUndefined()
    close(store)
    store = open(path)
    expect(store.getDraft(current.id).changes).toBeUndefined()
    store.saveDraft(current.id, emptyDraft())
    const next = { ...current, id: 'next', headSha: 'next-head' }
    store.savePull(next)
    expect(store.getDraft(next.id).changes).toMatchObject({ baselineHeadSha: current.headSha })
  })
})

describe('review progress upgrade', () => {
  it("migrates the previous release's reviewed whole hunk into section proof without losing notes", () => {
    const path = directory()
    const store = open(path)
    const canonical = sectionPull(
      base,
      base.replace('return 1', 'return 10').replace('return 2', 'return 20'),
    )
    const file = required(canonical.files[0])
    const legacy = {
      ...file,
      hunks: [
        {
          id: 'legacy-hunk',
          fileId: file.id,
          header: '@@ -1,7 +1,7 @@',
          lines: file.hunks.flatMap((hunk, index) =>
            index === 0 ? hunk.lines.slice(0, 4) : hunk.lines.slice(1),
          ),
        },
      ],
    }
    const previous = {
      ...canonical,
      files: [legacy],
      groups: canonical.groups.map((group) => ({ ...group, hunkIds: ['legacy-hunk'] })),
    }
    store.savePull(previous)
    close(store)
    seedLegacyEvidence(path, previous, legacy)
    const upgraded = open(path)
    const normalized = sectionedPull(previous)
    expect(upgraded.getPull(previous.id)).toEqual(normalized)
    expect(upgraded.getDraft(previous.id).draft).toMatchObject({
      summary: 'Preserve my review',
      viewedHunkIds: required(normalized.groups[0]).hunkIds,
    })
    const next = { ...canonical, id: 'after-migration', headSha: 'next' }
    upgraded.savePull(next)
    expect(upgraded.getDraft(next.id).draft.viewedHunkIds).toEqual(
      required(canonical.groups[0]).hunkIds,
    )
  })

  it('keeps incomplete and ambiguous sections unviewed across revisions', () => {
    const path = directory()
    const store = open(path)
    const pull = sectionPull('', 'repeat\n\nrepeat\n')
    required(pull.files[0]).hunks[1] = {
      ...required(required(pull.files[0]).hunks[0]),
      id: 'duplicate',
    }
    store.savePull(pull)
    store.saveDraft(pull.id, { ...emptyDraft(), viewedFileIds: [required(pull.files[0]).id] })
    const next = { ...pull, id: 'ambiguous-next', headSha: 'next' }
    store.savePull(next)
    expect(store.getDraft(next.id).draft.viewedHunkIds).toEqual([])
    const incomplete = {
      ...next,
      id: 'partial',
      headSha: 'partial-head',
      files: [
        parseFile({
          path: 'shared.ts',
          status: 'modified',
          additions: 100,
          deletions: 0,
          patch: '@@ -0,0 +1 @@\n+partial',
        }),
      ],
    }
    store.savePull(incomplete)
    expect(store.getDraft(incomplete.id).draft.viewedHunkIds).toEqual([])
    expect(store.getDraft(incomplete.id).changes?.removed).toEqual([])
  })
})
