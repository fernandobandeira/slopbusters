// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useBobSession } from '../src/features/bob/useBobSession'
import { Provider } from '../shared/domain/types'
import type { BobSession } from '../shared/domain/bob'
import { fixturePull } from './fixtures/pull'
import { fixtureBobAdvice } from './fixtures/bob'

const pull = fixturePull()
const saved: BobSession = {
  id: 'saved-old',
  repository: 'review-room/example',
  urls: [pull.url],
  primary: { provider: Provider.codex, model: 'codex' },
  companion: { provider: Provider.claude, model: 'claude' },
  status: 'complete',
  progress: 'Complete',
  createdAt: '2026-10-01T00:00:00Z',
  results: [{ pull, advice: fixtureBobAdvice(), fingerprint: 'saved', reviewers: [] }],
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('replays the session selected in the listing, then reconnects to a newly started review', async () => {
  const newer = { ...saved, id: 'new-review' }
  const fetch = vi.fn((url: string) =>
    Promise.resolve(Response.json(url.endsWith('/saved-old') ? saved : newer)),
  )
  vi.stubGlobal('fetch', fetch)
  const hook = renderHook(() => useBobSession(saved.repository, pull.url, saved.id))
  await waitFor(() => {
    expect(hook.result.current.session?.id).toBe(saved.id)
  })
  expect(fetch.mock.calls[0]?.[0]).toBe('/api/bob/saved-old')

  await act(() => hook.result.current.act('start', [pull.url]))
  await waitFor(() => {
    expect(hook.result.current.session?.id).toBe(newer.id)
  })
  act(() => {
    hook.result.current.reload()
  })
  await waitFor(() => {
    expect(fetch.mock.calls.at(-1)?.[0]).toBe('/api/bob/new-review')
  })
  expect(fetch.mock.calls.some(([url]) => url.includes('/latest'))).toBe(false)
})
