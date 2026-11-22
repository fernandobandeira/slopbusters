// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as recordRoutes from '../../../../shared/api/stackReviewRecords'
import { claimSnapshot } from '../../../../shared/domain/stackDecisionSnapshot'
import { call } from '../../../../src/lib/api'
import { stackDecisionRecord } from '../../../fixtures/stackDecisionRecord'
import { emptyResult, finishedStackReview, stackEntry } from '../../../fixtures/stackReview'
import { enabledButton, renderPage } from '../../../fixtures/stackReviewPage'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

it('shows a 409 saving an answer and reloads the card for the next attempt', async () => {
  const { session, records, brief } = renderPage()
  const previous = vi.mocked(call).getMockImplementation()!
  const real =
    await vi.importActual<typeof import('../../../../src/lib/api')>('../../../../src/lib/api')
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json(
          { error: 'This record changed in another tab. Reload it and try again.' },
          { status: 409 },
        ),
      ),
    ),
  )
  const id = '#203/g2'
  const decision = brief.decisions.find((item) => item.id === id)!
  vi.mocked(call).mockImplementation((route, input, options) => {
    if (route === recordRoutes.putStackAnswer && !records.has(id)) {
      records.set(id, stackDecisionRecord(brief, decision, null, 2))
      return real.call(route, input, options)
    }
    return previous(route, input, options)
  })

  fireEvent.click(
    await enabledButton(
      'Follow the plan',
      within((await screen.findByRole('heading', { name: decision.title })).closest('article')!),
    ),
  )
  expect((await screen.findByRole('alert')).textContent).toContain(
    'This record changed in another tab.',
  )
  await waitFor(() => {
    expect(
      vi.mocked(call).mock.calls.filter(([route]) => route === recordRoutes.getStackRecords),
    ).toHaveLength(2)
  })
  const card = within(screen.getByRole('heading', { name: decision.title }).closest('article')!)
  fireEvent.click(await enabledButton('Follow the plan', card))
  await screen.findByRole('heading', { name: 'Answered · 1' })
  expect(call).toHaveBeenCalledWith(recordRoutes.putStackAnswer, {
    params: { id: session.id },
    body: { decisionId: id, expectedRevision: 2, answer: { state: 'chosen', optionId: 'change' } },
  })
})

it('saves and clears a serious consequence on the page', async () => {
  const session = finishedStackReview([
    stackEntry(201, 'guard', {
      title: 'Guard the queue',
      impact: 'data',
      consequence: 'Pending jobs can disappear.',
    }),
  ])
  const { brief, records, response } = renderPage(session)
  const previous = vi.mocked(call).getMockImplementation()!
  const claim = brief.serious[0]!
  vi.mocked(call).mockImplementation((route, input, options) => {
    if (route !== recordRoutes.putStackDisposition) return previous(route, input, options)
    const { claimId, expectedRevision, disposition } =
      recordRoutes.putStackDisposition.request.parse(input.body)
    records.set(claimId, {
      kind: 'serious_claim',
      sessionId: session.id,
      itemId: claimId,
      repository: session.repository,
      sourcePr: claim.layer,
      targetPr: null,
      revision: expectedRevision + 1,
      updatedAt: session.createdAt,
      snapshot: claimSnapshot(brief, claim),
      answer: null,
      disposition,
    })
    return response()
  })
  const band = within(
    (await screen.findByRole('heading', { name: 'Serious consequences' })).closest('section')!,
  )
  band.getByText('Record disposition').closest('details')!.open = true
  fireEvent.change(band.getByRole('combobox', { name: 'Disposition' }), {
    target: { value: 'accepted' },
  })
  fireEvent.change(band.getByRole('textbox', { name: 'Reason' }), {
    target: { value: 'The queue can be replayed.' },
  })
  fireEvent.click(await enabledButton('Save disposition', band))
  await band.findByText('Accepted as a risk. The queue can be replayed.')

  band.getByText('Edit disposition').closest('details')!.open = true
  fireEvent.click(await enabledButton('Clear disposition', band))
  await band.findByText('Record disposition')
  expect(band.queryByText('Accepted as a risk. The queue can be replayed.')).toBeNull()
  expect(call).toHaveBeenLastCalledWith(recordRoutes.putStackDisposition, {
    params: { id: session.id },
    body: { claimId: claim.id, expectedRevision: 1, disposition: null },
  })
})

it('opens a group with stale and serious-related cards and counts only eligible defaults', async () => {
  const predicted = { disposition: 'prepare', verdict: 'predicted' } as const
  const session = finishedStackReview(
    [
      stackEntry(201, 'ready', predicted),
      stackEntry(202, 'stale', predicted),
      stackEntry(203, 'related', predicted),
      stackEntry(203, 'risk', { impact: 'data', consequence: 'Pending jobs can disappear.' }),
    ],
    {
      ...emptyResult,
      duplicates: [
        {
          entries: ['#203/related', '#203/risk'],
          owner: '#203/related',
          reason: 'The same queue.',
        },
      ],
    },
  )
  session.layers[1]!.baseSha = 'new-base'
  renderPage(session)
  const group = (
    await screen.findByText('A reviewer will probably ask, the models would not · 3')
  ).closest('details')!
  expect(group.open).toBe(true)
  expect(
    screen.getByText('0 of 3 answered. 2 questions need you. 1 more has a default.'),
  ).toBeTruthy()
  expect(within(group).getAllByText('Default')).toHaveLength(1)
  fireEvent.click(await enabledButton('Keep the code, replies ready · 1', within(group)))
  await screen.findByRole('heading', { name: 'Answered · 1' })
  expect(screen.getByText('1 of 3 answered. 2 questions need you.')).toBeTruthy()
  expect(within(group).getByText('No default')).toBeTruthy()
  expect(within(group).queryByRole('button', { name: /Keep the code, replies ready/ })).toBeNull()
})
