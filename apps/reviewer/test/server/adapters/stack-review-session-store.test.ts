import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReviewerStore } from '../../../server/adapters/store'
import { stackBrief } from '../../../shared/domain/stackBrief'
import { emptyResult, finishedStackReview, stackEntry } from '../../fixtures/stackReview'

let data: string
let store: ReviewerStore

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'stack-store-'))
  store = new ReviewerStore({ dataDirectory: data })
})
afterEach(() => {
  store.close()
  rmSync(data, { recursive: true, force: true })
})

describe('a stack review saved with earlier-round entries', () => {
  it('reads back without them and still produces its brief', () => {
    const earlier = { ...stackEntry(202, 'g4'), id: '#202/earlier/g4', earlier: true }
    const saved = finishedStackReview([stackEntry(201, 'g1'), stackEntry(202, 'g1')], {
      ...emptyResult,
      duplicates: [
        { entries: ['#201/g1', '#202/g1', '#202/earlier/g4'], owner: '#201/g1', reason: 'Same.' },
        { entries: ['#202/g1', '#202/earlier/g4'], owner: '#202/g1', reason: 'Raised before.' },
      ],
    })
    saved.input?.entries.push(earlier)
    saved.input?.left.push('#202/earlier/g4')
    store.stackReview.save(saved)

    const read = store.stackReview.get(saved.id)

    expect(read?.input?.entries.map((entry) => entry.id)).toEqual(['#201/g1', '#202/g1'])
    expect(read?.input?.left).toEqual([])
    expect(read?.pass?.result?.duplicates).toEqual([
      { entries: ['#201/g1', '#202/g1'], owner: '#201/g1', reason: 'Same.' },
    ])
    const brief = read && stackBrief(read)
    expect(brief?.fixes.map(({ layer, items }) => [layer.number, items.map((i) => i.id)])).toEqual([
      [201, ['#201/g1']],
    ])
    expect(brief?.fixes[0]?.items[0]?.alsoRaised).toEqual(['#202/g1'])
  })
})
