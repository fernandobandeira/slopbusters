// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api/layerFix'
import type { ApiContract } from '../../../../shared/api/contract'
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
})

it('starts selected fixes and renders the observed outcome', async () => {
  vi.mocked(call).mockImplementation((route: ApiContract) => {
    if (route === routes.latestLayerFix) return Promise.resolve({ session: null })
    if (route === routes.startLayerFix) return Promise.resolve(fixtureLayerFix())
    return Promise.reject(new Error('Unexpected route'))
  })
  render(
    <LayerFixWorker
      stack="stack-1"
      url={layerUrl(201)}
      current
      fixes={[
        {
          id: '#201/g1',
          title: 'Handle missing data',
          plan: 'Return an empty list.',
          triage: 'Fix the crash.',
          alsoRaised: [],
          contested: false,
        },
      ]}
    />,
  )
  const button = await screen.findByRole('button', { name: 'Apply fixes' })
  await waitFor(() => {
    expect(button.hasAttribute('disabled')).toBe(false)
  })
  fireEvent.click(button)
  expect(await screen.findByText('done: Fixes committed locally. Nothing pushed.')).toBeTruthy()
  expect(screen.getByText('#201/g1: applied — Handles missing data.')).toBeTruthy()
  expect(screen.getByText('Left for the author: Update the title')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open fix thread' })).toBeTruthy()
  expect(call).toHaveBeenCalledWith(routes.startLayerFix, {
    body: { stack: 'stack-1', url: layerUrl(201), entries: ['#201/g1'] },
  })
})
