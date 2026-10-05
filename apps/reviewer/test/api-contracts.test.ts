import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import { routeUrl } from '../shared/api/contract'
import { call } from '../src/lib/api'
import { fixturePull } from './fixtures/pull'

afterEach(() => vi.unstubAllGlobals())

describe('shared API contracts', () => {
  it('encodes route parameters and query strings through the contract', () => {
    expect(
      routeUrl(routes.getSourceFile, {
        params: { id: 'review' },
        query: { side: 'RIGHT', path: 'src/a & b.ts' },
      }),
    ).toBe('/api/pulls/review/source-file?side=RIGHT&path=src%2Fa+%26+b.ts')
    expect(routeUrl(routes.replyToThread, { params: { id: 'review', threadId: 'a/b?#' } })).toBe(
      '/api/pulls/review/threads/a%2Fb%3F%23/replies',
    )
  })

  it('rejects malformed response data instead of casting it to a client type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ id: 'review', title: 'missing snapshot' })),
    )
    await expect(call(routes.getPull, { params: { id: 'review' } })).rejects.toThrow(
      'invalid response',
    )
  })

  it('validates requests before making a network call and uses the route method', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(fixturePull()))
    vi.stubGlobal('fetch', fetch)
    await expect(
      call(routes.loadPull, { body: { url: 'https://other.example/pull/1' } }),
    ).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()

    await call(routes.loadPull, { body: { url: fixturePull().url } })
    expect(fetch).toHaveBeenCalledWith(
      '/api/pulls',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ url: fixturePull().url }) }),
    )
  })
})
