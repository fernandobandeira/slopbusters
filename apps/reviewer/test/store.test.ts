import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReviewerStore } from '../server/store'
import { emptyDraft } from '../shared/progress'
import { DiffSide } from '../shared/types'
import { fixturePull } from './fixtures/pull'
import { startReviewerServer } from '../server/app'

const directories: string[] = []
const stores: ReviewerStore[] = []
function directory() {
  const value = mkdtempSync(join(tmpdir(), 'review-store-'))
  directories.push(value)
  return value
}
function open(dataDirectory: string) {
  const store = new ReviewerStore({ dataDirectory })
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

describe('SQLite review storage', () => {
  it('persists snapshots, drafts, preferences, and reviewed proof after reopening', () => {
    const path = directory()
    let store = open(path)
    const pull = fixturePull()
    store.savePull(pull)
    const draft = { ...emptyDraft(), summary: 'A saved note', viewedFileIds: [pull.files[0]!.id] }
    store.saveDraft(pull.id, draft)
    store.savePreferences({ theme: 'nord' })
    close(store)
    store = open(path)
    expect(store.getPull(pull.id)).toEqual(pull)
    expect(store.getDraft(pull.id)).toMatchObject({
      exists: true,
      draft: {
        summary: draft.summary,
        viewedFileIds: draft.viewedFileIds,
        viewedHunkIds: pull.files[0]!.hunks.map((hunk) => hunk.id),
      },
    })
    expect(store.getPreferences()).toEqual({ theme: 'nord' })
  })
  it('carries unchanged review proof to a new revision while keeping notes and comments on the old revision', () => {
    const store = open(directory())
    const pull = fixturePull()
    store.savePull(pull)
    const draft = {
      ...emptyDraft(),
      summary: 'For old head only',
      viewedFileIds: [pull.files[0]!.id],
      comments: [
        {
          id: 'c1',
          body: 'Check this',
          path: pull.files[0]!.path,
          line: 1,
          side: DiffSide.right,
          headSha: pull.headSha,
        },
      ],
    }
    store.saveDraft(pull.id, draft)
    const next = { ...pull, id: 'next-revision', headSha: 'new-head' }
    store.savePull(next)
    expect(store.getDraft(next.id)).toMatchObject({
      exists: false,
      draft: { comments: [], summary: '', viewedFileIds: draft.viewedFileIds },
    })
    expect(store.getDraft(pull.id).draft.comments).toEqual(draft.comments)
    expect(() => store.saveDraft(next.id, draft)).toThrow('different PR revision')
    store.saveDraft(next.id, emptyDraft())
    expect(store.getDraft(pull.id).draft.viewedFileIds).toEqual([])
    expect(store.getDraft(pull.id).draft.summary).toEqual(draft.summary)
    expect(store.getDraft(pull.id).draft.comments).toEqual(draft.comments)
  })
  it('ignores an old in-flight write when a final newer writer sequence arrived first', () => {
    const store = open(directory())
    const pull = fixturePull()
    store.savePull(pull)
    store.saveDraft(
      pull.id,
      { ...emptyDraft(), summary: 'Newest edit' },
      { writerId: 'window1', sequence: 2 },
    )
    store.saveDraft(
      pull.id,
      { ...emptyDraft(), summary: 'Outdated edit' },
      { writerId: 'window1', sequence: 1 },
    )
    expect(store.getDraft(pull.id).draft.summary).toBe('Newest edit')
  })
  it('imports legacy JSON snapshots without requiring a fresh fetch', () => {
    const path = directory()
    mkdirSync(join(path, 'pulls'))
    const pull = fixturePull()
    writeFileSync(join(path, 'pulls', `${pull.id}.json`), JSON.stringify(pull))
    writeFileSync(join(path, 'pulls', 'broken.json'), '{')
    const store = open(path)
    expect(store.getPull(pull.id)).toEqual(pull)
    expect(store.getDraft(pull.id).exists).toBe(false)
  })
  it('does not carry incomplete patch review into a later revision', () => {
    const store = open(directory())
    const pull = fixturePull()
    pull.files[0]!.coverage = 'partial'
    store.savePull(pull)
    store.saveDraft(pull.id, { ...emptyDraft(), viewedFileIds: [pull.files[0]!.id] })
    const next = { ...pull, id: 'updated-partial', headSha: 'new-head' }
    store.savePull(next)
    expect(store.getDraft(pull.id).draft.viewedFileIds).toContain(pull.files[0]!.id)
    expect(store.getDraft(next.id).draft.viewedFileIds).toEqual([])
  })
})

describe('embedded review API', () => {
  it('serves validated durable drafts/preferences and rejects unrelated local origins', async () => {
    const path = directory()
    const pull = fixturePull()
    const seed = open(path)
    seed.savePull(pull)
    close(seed)
    const server = await startReviewerServer({
      dataDirectory: path,
      staticDirectory: path,
      port: 0,
    })
    try {
      const base = `${server.url}/api`
      const draftUrl = `${base}/pulls/${pull.id}/draft`
      const initial = await fetch(draftUrl)
      expect(await initial.json()).toMatchObject({ exists: false })
      const put = await fetch(draftUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...emptyDraft(), summary: 'Saved via API' }),
      })
      expect(put.status).toBe(200)
      expect(await put.json()).toMatchObject({ exists: true, draft: { summary: 'Saved via API' } })
      expect(
        (await fetch(`${base}/preferences`, { headers: { Origin: 'http://localhost:9999' } }))
          .status,
      ).toBe(403)
      expect((await fetch(`${base}/preferences`, { headers: { Origin: server.url } })).status).toBe(
        200,
      )
      expect(
        (
          await fetch(draftUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(400)
      expect((await fetch(`${base}/pulls/missing/draft`)).status).toBe(404)
    } finally {
      await server.close()
    }
  })
})
