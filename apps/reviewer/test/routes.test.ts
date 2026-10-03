import { describe, expect, it } from 'vitest'
import { parsePullUrl } from '../shared/pullUrl'
import {
  inboxPath,
  readRoute,
  readReviewView,
  reviewPath,
  routeMatchesPull,
  updateReviewView,
} from '../src/routes'
import { fixturePull } from './fixtures/pull'

function route(path: string) {
  const url = new URL(path, 'http://localhost:4310')
  return readRoute(url)
}

describe('repository and PR routes', () => {
  it('opens application settings as a separate page', () => {
    expect(route('/settings')).toEqual({ kind: 'settings', filter: 'mine' })
  })
  it('restores the repository and inbox filter from generated paths', () => {
    for (const filter of ['mine', 'others', 'requested'] as const) {
      expect(route(inboxPath('owner/repo.name', filter))).toEqual({
        kind: 'inbox',
        repository: 'owner/repo.name',
        filter,
      })
    }
    expect(route('/')).toEqual({ kind: 'inbox', filter: 'mine' })
    expect(route('/repos/owner/repo/pulls?inbox=unknown')).toMatchObject({ filter: 'mine' })
  })

  it('opens GitHub PR links with their originating inbox and revision', () => {
    const path = reviewPath({
      url: 'https://github.com/owner/repo/pull/123/files#diff-abc',
      filter: 'others',
    })
    expect(route(`${path}&revision=abc123`)).toEqual({
      kind: 'pull',
      repository: 'owner/repo',
      number: 123,
      revision: 'abc123',
      filter: 'others',
    })
  })

  it('rejects invalid paths, PR numbers, snapshot IDs, and GitHub hosts', () => {
    for (const path of [
      '/unknown',
      '/repos/owner/repo/pulls/0',
      '/repos/owner/repo/pulls/-1',
      '/repos/owner/repo/pulls/1e3',
      '/repos/owner/repo/pulls/9007199254740992',
      '/repos/owner/repo/pulls/123?revision=../another',
    ]) {
      expect(route(path)).toEqual({ kind: 'not-found' })
    }
    expect(() => parsePullUrl('https://github.com.evil.test/owner/repo/pull/123')).toThrow()
    expect(() => parsePullUrl('https://github.com/owner/repo/pull/0')).toThrow()
  })

  it('accepts cached snapshots only for the requested repository and PR', () => {
    const pull = fixturePull()
    const requested = route(reviewPath({ url: pull.url, filter: 'mine' }))
    expect(routeMatchesPull(requested, pull)).toBe(true)
    expect(routeMatchesPull(requested, { ...pull, number: pull.number + 1 })).toBe(false)
    expect(routeMatchesPull(requested, { ...pull, repo: 'another-repo' })).toBe(false)
    expect(routeMatchesPull(route('/'), pull)).toBe(false)
  })
})

describe('review view URLs', () => {
  it('preserves the revision and inbox while encoding groups and diff preferences', () => {
    const initial = new URLSearchParams('inbox=others&revision=abc123&group=permissions')
    const query = updateReviewView(initial, {
      groupId: 'authorization + contracts',
      split: true,
    })
    const restored = new URLSearchParams(query.toString())
    expect(restored.get('inbox')).toBe('others')
    expect(restored.get('revision')).toBe('abc123')
    expect(readReviewView(restored)).toEqual({
      groupId: 'authorization + contracts',
      split: true,
    })
    expect(initial.get('group')).toBe('permissions')
  })

  it('ignores legacy file views and clears them when diff preferences change', () => {
    const initial = new URLSearchParams('view=files&file=src/a.ts&diff=split&priority=P1')
    expect(readReviewView(initial)).toEqual({ groupId: undefined, split: true })
    const query = updateReviewView(initial, {
      groupId: 'authorization',
      split: false,
    })
    expect(query.has('view')).toBe(false)
    expect(query.has('file')).toBe(false)
    expect(query.has('priority')).toBe(false)
    expect(query.has('diff')).toBe(false)
    expect(readReviewView(query)).toMatchObject({
      groupId: 'authorization',
      split: false,
    })
    expect(
      readReviewView(new URLSearchParams('view=unknown&priority=unknown&diff=unknown')),
    ).toEqual({ groupId: undefined, split: false })
  })

  it('ignores legacy priority filters and clears them when review preferences change', () => {
    const initial = new URLSearchParams(
      'inbox=mine&revision=abc123&view=groups&group=authorization&priority=P1&diff=split',
    )
    expect(readReviewView(initial)).toEqual({
      groupId: 'authorization',
      split: true,
    })
    const query = updateReviewView(initial, { groupId: 'contracts' })
    expect(query.has('priority')).toBe(false)
    expect(query.get('inbox')).toBe('mine')
    expect(query.get('revision')).toBe('abc123')
    expect(readReviewView(query)).toMatchObject({
      groupId: 'contracts',
      split: true,
    })
    expect(initial.get('priority')).toBe('P1')
  })

  it('restores bookmarked groups and split preference after forward and back navigation', () => {
    const first = new URLSearchParams('inbox=requested&revision=abc123&group=authorization')
    const second = updateReviewView(first, { groupId: 'contracts', split: true })
    const third = updateReviewView(second, { split: false })
    expect(readReviewView(new URLSearchParams(first.toString()))).toEqual({
      groupId: 'authorization',
      split: false,
    })
    expect(readReviewView(new URLSearchParams(second.toString()))).toEqual({
      groupId: 'contracts',
      split: true,
    })
    expect(readReviewView(third)).toEqual({ groupId: 'contracts', split: false })
    expect(third.get('inbox')).toBe('requested')
    expect(third.get('revision')).toBe('abc123')
    expect(readReviewView(updateReviewView(second, { groupId: undefined }))).toEqual({
      groupId: undefined,
      split: true,
    })
  })

  it('clears legacy selection queries even when the selected group stays unchanged', () => {
    const query = updateReviewView(
      new URLSearchParams('view=files&file=src/a.ts&priority=P1&group=authorization'),
      {},
    )
    expect(query.toString()).toBe('group=authorization')
  })
})
