// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provider } from '../shared/domain/types'
import { useLinusSession } from '../src/features/linus/useLinusSession'

const repository = 'review-room/example'
const url = `https://github.com/${repository}/pull/128`
function session(id: string) {
  const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }
  return {
    id,
    repository,
    urls: [url],
    primary: model,
    companion: model,
    status: 'complete',
    progress: '',
    createdAt: '',
    results: [],
  }
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Requested Linus session', () => {
  it('loads the launched session instead of the repository’s latest session', async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json(session('launched'))))
    vi.stubGlobal('fetch', fetch)
    const hook = renderHook(() => useLinusSession(repository, 'launched'))
    await waitFor(() => {
      expect(hook.result.current.session?.id).toBe('launched')
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      '/api/linus/launched',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('reconnects to a newly started session after reviewing other PRs', async () => {
    const fetch = vi.fn((path: string) =>
      Promise.resolve(Response.json(session(path.endsWith('/first') ? 'first' : 'next'))),
    )
    vi.stubGlobal('fetch', fetch)
    const hook = renderHook(() => useLinusSession(repository, 'first'))
    await waitFor(() => {
      expect(hook.result.current.session?.id).toBe('first')
    })
    await act(() => hook.result.current.act('start', [url]))
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/linus/next', expect.anything())
    })
    act(() => {
      hook.result.current.reload()
    })
    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith(
        '/api/linus/next',
        expect.objectContaining({ method: 'GET' }),
      )
      expect(fetch.mock.calls.filter(([path]) => path === '/api/linus/next')).toHaveLength(2)
    })
    expect(hook.result.current.session?.id).toBe('next')
  })
})
