// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api/layerFix'
import type { ApiContract } from '../../../../shared/api/contract'
import type { ComponentProps } from 'react'
import { useStackFixSelection } from '../../../../src/features/stack-review/useStackFixSelection'
import { LayerFixWorker } from '../../../../src/features/stack-review/LayerFixWorker'
import { call } from '../../../../src/lib/api'
import { fixtureLayerFix } from '../../../fixtures/layerFix'
import { layerUrl } from '../../../fixtures/stackReview'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function Worker(props: Omit<ComponentProps<typeof LayerFixWorker>, 'selection'>) {
  const selection = useStackFixSelection(props.stack, [{ layer: props.layer, items: props.fixes }])
  return (
    <>
      <button disabled={selection.disabled} onClick={() => void selection.apply()}>
        Fix selected
      </button>
      <LayerFixWorker key={selection.revision} {...props} selection={selection} />
    </>
  )
}

it('starts selected fixes and renders the observed outcome', async () => {
  let started = false
  vi.mocked(call).mockImplementation((route: ApiContract) => {
    if (route === routes.latestLayerFix)
      return Promise.resolve({
        session: started ? fixtureLayerFix() : null,
        availability: { applied: [] },
        retryable: false,
      })
    if (route === routes.startStackFixes) {
      started = true
      return Promise.resolve([fixtureLayerFix()])
    }
    return Promise.reject(new Error('Unexpected route'))
  })
  render(
    <Worker
      stack="stack-1"
      layer={{ url: layerUrl(201), number: 201, title: 'Layer 201', current: true }}
      fixes={[
        {
          id: '#201/g1',
          title: 'Handle missing data',
          plan: 'Return an empty list.',
          triage: 'Fix the crash.',
          alsoRaised: [],
        },
      ]}
    />,
  )
  const button = await screen.findByRole('button', { name: 'Fix selected' })
  await waitFor(() => {
    expect(button.hasAttribute('disabled')).toBe(false)
  })
  fireEvent.click(button)
  expect(await screen.findByText('done: Fixes committed locally. Nothing pushed.')).toBeTruthy()
  expect(screen.getByText('#201/g1: applied — Handles missing data.')).toBeTruthy()
  expect(screen.getByText('Left for the author: Update the title')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open fix thread' })).toBeTruthy()
  expect(call).toHaveBeenCalledWith(routes.startStackFixes, {
    body: { stack: 'stack-1', groups: [{ url: layerUrl(201), entries: ['#201/g1'] }] },
  })
})

it('refreshes server availability when polling sees the worker stop', async () => {
  vi.useFakeTimers()
  const finished = fixtureLayerFix()
  const running = fixtureLayerFix({ status: 'running', outcome: undefined, results: [] })
  let stopped = false
  vi.mocked(call).mockImplementation((route: ApiContract) => {
    if (route === routes.latestLayerFix)
      return Promise.resolve({
        session: stopped ? finished : running,
        availability: stopped
          ? { applied: ['#201/g1'], blocked: 'Retained local commits' }
          : { applied: [] },
        retryable: false,
      })
    if (route === routes.getLayerFix) {
      stopped = true
      return Promise.resolve(finished)
    }
    return Promise.reject(new Error('Unexpected route'))
  })
  await act(() => {
    render(
      <Worker
        stack="stack-1"
        layer={{ url: layerUrl(201), number: 201, title: 'Layer 201', current: true }}
        fixes={[
          { id: '#201/g1', title: 'Handle missing data', triage: 'Fix the crash.', alsoRaised: [] },
        ]}
      />,
    )
    return Promise.resolve()
  })
  expect(screen.getByRole('button', { name: 'Cancel fixes' })).toBeTruthy()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000)
  })
  expect(screen.getByText('Retained local commits')).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: 'Handle missing data' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Retry fixes' })).toBeNull()
})
