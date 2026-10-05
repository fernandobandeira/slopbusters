// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineRoute } from '../shared/api/contract'
import { useApiQuery } from '../src/lib/useApiQuery'
const route = defineRoute('GET', '/items/:id', {
  params: z.object({ id: z.string() }),
  response: z.object({ name: z.string() }),
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('aborts a replaced request and ignores its late result', async () => {
  let finishOld: (response: Response) => void = () => {}
  const oldResponse = new Promise<Response>((resolve) => {
    finishOld = resolve
  })
  const fetch = vi
    .fn((_url: string, _options?: RequestInit) => oldResponse)
    .mockImplementationOnce(() => oldResponse)
    .mockImplementationOnce(() => Promise.resolve(Response.json({ name: 'Current' })))
  vi.stubGlobal('fetch', fetch)
  const hook = renderHook(({ id }) => useApiQuery(route, { params: { id } }), {
    initialProps: { id: 'old' },
  })
  hook.rerender({ id: 'current' })
  await waitFor(() => {
    expect(hook.result.current.data?.name).toBe('Current')
  })
  expect(fetch.mock.calls.at(0)?.[1]?.signal?.aborted).toBe(true)
  await act(async () => {
    finishOld(Response.json({ name: 'Old' }))
    await oldResponse
  })
  expect(hook.result.current.data?.name).toBe('Current')
})
