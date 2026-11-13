// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import type { StackReviewSession } from '../../../../shared/domain/stackReview'
import { Provider } from '../../../../shared/domain/types'
import { StackReview } from '../../../../src/features/stack-review/StackReview'
import { call } from '../../../../src/lib/api'
import {
  emptyResult,
  finishedStackReview,
  layerUrl,
  stackEntry,
} from '../../../fixtures/stackReview'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const finished = finishedStackReview(
  [
    stackEntry(201, 'g1'),
    stackEntry(203, 'g2', { title: 'Remove the retry job', kind: 'simplification' }),
    stackEntry(202, 'g3', {
      disposition: 'ask',
      title: 'Keep the export column',
      question: 'Should the export keep the old column?',
    }),
  ],
  {
    ...emptyResult,
    chains: [{ cause: '#203/g2', unnecessary: ['#201/g1'], reason: 'Nothing else reads it.' }],
  },
)
const running: StackReviewSession = {
  ...finished,
  status: 'running',
  progress: 'Running the panel on the layers without an up-to-date review…',
  input: undefined,
  pass: undefined,
  layers: finished.layers.map((layer, index) => ({
    ...layer,
    state: index ? 'reviewing' : 'reused',
  })),
}

describe('reviewing the whole stack', () => {
  it('starts with the reviewers last picked, shows each layer, then the brief to copy', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    let session = running
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.latestStackReview) return Promise.resolve({ session: null })
      if (route === routes.startStackReview) return Promise.resolve(running)
      if (route === routes.getStackReview) return Promise.resolve(session)
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    render(
      <StackReview
        url={layerUrl(202)}
        reviewers={[{ id: 'unclebob', providers: [Provider.codex] }]}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Review the whole stack' }))

    expect(await screen.findAllByText('The panel is reviewing it.')).toHaveLength(2)
    expect(call).toHaveBeenCalledWith(routes.startStackReview, {
      body: { url: layerUrl(202), reviewers: [{ id: 'unclebob', providers: [Provider.codex] }] },
    })
    session = finished
    await act(() => vi.advanceTimersByTimeAsync(2000))
    const decisions = await screen.findByRole('heading', { name: 'Needs your decision' })
    const fixes = screen.getByRole('region', { name: 'Fixes on PR #203' })
    expect(decisions.compareDocumentPosition(fixes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Should the export keep the old column?')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Fixes on PR #201' })).toBeNull()
    expect(screen.getByText('Nothing else reads it.', { exact: false })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining('# Stack review of review-room/example, PR #201 to PR #203'),
      )
    })
  })

  it('offers a retry when a layer stopped the review', async () => {
    const partial = {
      ...running,
      status: 'partial' as const,
      progress: 'PR #202 stopped the stack review. Retry continues from there.',
    }
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.latestStackReview) return Promise.resolve({ session: partial })
      if (route === routes.retryStackReview) return Promise.resolve(running)
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    render(<StackReview url={layerUrl(201)} reviewers={['unclebob']} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Retry the stack review' }))

    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(routes.retryStackReview, { params: { id: 'stack-1' } })
    })
    expect(await screen.findByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('says which decisions and chains the second model did not approve', async () => {
    const exhausted = structuredClone(finished)
    if (!exhausted.pass) throw new Error('Missing pass.')
    exhausted.pass.outcome = 'exhausted'
    exhausted.pass.contested = ['chain #203/g2', 'chain #202/g3']
    vi.mocked(call).mockImplementation((route: ApiContract) =>
      route === routes.latestStackReview
        ? Promise.resolve({ session: exhausted })
        : Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`)),
    )
    render(<StackReview url={layerUrl(201)} reviewers={['unclebob']} />)

    expect(
      await screen.findByText(/Nothing else reads it\. The second model did not approve this\./),
    ).toBeTruthy()
    expect(screen.getByText(/Cost: small · The second model did not approve this/)).toBeTruthy()
  })
})
