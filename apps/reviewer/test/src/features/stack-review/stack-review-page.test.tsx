// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import { latestLayerFix } from '../../../../shared/api/layerFix'
import { stackBrief } from '../../../../shared/domain/stackBrief'
import { stackBriefMarkdown } from '../../../../shared/domain/stackBriefMarkdown'
import { StackReviewPage } from '../../../../src/features/stack-review/StackReviewPage'
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
  vi.unstubAllGlobals()
})

function savedReview() {
  const session = finishedStackReview([
    stackEntry(201, 'g1', { title: 'Handle missing data', plan: 'Return an empty list.' }),
    stackEntry(203, 'g2', {
      disposition: 'ask',
      title: 'Keep the export column',
      question: 'Should the export keep the old column?',
    }),
    stackEntry(202, 'g3', { disposition: 'ask', verdict: 'predicted', title: 'Name the limit' }),
    stackEntry(202, 'g4', {
      disposition: 'skip',
      followUp: true,
      title: 'Tighten the retry window',
    }),
  ])
  session.input!.left = ['#202/g4']
  session.input!.limitations = [
    "To fit the cross-layer pass's budget, 1 skipped entry was left out of it: #202/g4.",
  ]
  session.layers[1]!.baseSha = 'new-base'
  return session
}

function renderPage(session = savedReview()) {
  vi.mocked(call).mockImplementation((route: ApiContract) => {
    if (route === routes.latestStackReview) return Promise.resolve({ session })
    if (route === latestLayerFix) return Promise.resolve({ session: null })
    return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
  })
  render(
    <MemoryRouter>
      <StackReviewPage url={layerUrl(202)} reviewers={['unclebob']} backPath="/pull" />
    </MemoryRouter>,
  )
  return session
}

it('loads a saved review, opens groups without a default and keeps other disclosures closed', async () => {
  renderPage()
  const heading = await screen.findByRole('heading', { name: 'Needs your answer · 2' })
  const open = screen.getByText('Your call · 1')
  const predicted = screen.getByText('A reviewer will probably ask, the models would not · 1')
  expect(heading.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(open.compareDocumentPosition(predicted) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(open.closest('details')?.open).toBe(true)
  expect(predicted.closest('details')?.open).toBe(false)
  expect(
    screen.getByText('1 question needs you. 1 more has a default. 1 fix is ready.'),
  ).toBeTruthy()
  const warning = screen.getByText(/The cross-layer pass did not read 1 entry/)
  expect(warning.closest('details')).toBeNull()
  expect(screen.getByText('Left out · 1').closest('details')?.open).toBe(false)
  expect(screen.getAllByText('Tighten the retry window')).toHaveLength(1)
  expect(screen.queryByText('Follow-ups · 1')).toBeNull()
  expect(
    screen.getByText('Should the export keep the old column?', { exact: false }).closest('summary'),
  ).toBeNull()
  expect(
    screen.getByText('Should the export keep the old column?', { exact: false }).closest('details')
      ?.textContent,
  ).toContain('Evidence and history')
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.getByRole('link', { name: 'Back to pull request' }).getAttribute('href')).toBe(
    '/pull',
  )
})

it('filters bands by layer and shows one checkbox, title and plan per fix', async () => {
  renderPage()
  const rail = await screen.findByRole('navigation', { name: 'Filter review by layer' })
  const rows = within(rail).getAllByRole('button')
  expect(rows.map((row) => row.textContent.match(/Whole stack|#20[123]/)?.[0])).toEqual([
    'Whole stack',
    '#203',
    '#202',
    '#201',
  ])
  expect(within(rail).getByText('Moved').title).toContain('Reviewed base base-20')
  const fixes = screen.getByText('#201 Layer 201 · 1 fix').closest('details')!
  expect(fixes.open).toBe(false)
  fixes.open = true
  expect(within(fixes).getAllByText('Handle missing data')).toHaveLength(1)
  expect(within(fixes).getByRole('checkbox', { name: 'Handle missing data' })).toBeTruthy()
  expect(within(fixes).getByText('Return an empty list.')).toBeTruthy()
  expect(within(fixes).getByRole('button', { name: 'Apply 1 fix locally on #201' })).toBeTruthy()

  fireEvent.click(rows[2]!)
  expect(screen.getByRole('heading', { name: 'Needs your answer · 1' })).toBeTruthy()
  expect(screen.queryByText('Your call · 1')).toBeNull()
  expect(screen.queryByRole('heading', { name: /Ready to fix/ })).toBeNull()
  expect(screen.getByText('Left out · 1')).toBeTruthy()

  fireEvent.click(rows[3]!)
  expect(screen.getByRole('heading', { name: 'Ready to fix · 1' })).toBeTruthy()
  expect(screen.queryByText('Left out · 1')).toBeNull()
  expect(screen.getByText(/The cross-layer pass did not read 1 entry/)).toBeTruthy()
})

it('explains why fixes are disabled on a layer that moved', async () => {
  const session = finishedStackReview([stackEntry(201, 'guard')])
  session.layers[0]!.headSha = 'new-head'
  renderPage(session)
  const fixes = (await screen.findByText('#201 Layer 201 · 1 fix')).closest('details')!
  fixes.open = true
  expect(within(fixes).getByText(/moved since its panel reviewed/)).toBeTruthy()
  expect(within(fixes).getByRole('button', { name: 'Apply 1 fix locally on #201' })).toHaveProperty(
    'disabled',
    true,
  )
})

it('puts each contested cross-layer question on its card with evidence still closed', async () => {
  const session = finishedStackReview(
    [
      stackEntry(201, 'cause'),
      stackEntry(202, 'chain'),
      stackEntry(203, 'duplicate'),
      stackEntry(203, 'ownership', { disposition: 'ask', question: 'Keep the guard?' }),
    ],
    {
      ...emptyResult,
      chains: [{ cause: '#201/cause', unnecessary: ['#202/chain'], reason: 'The caller is gone.' }],
      duplicates: [
        { owner: '#201/cause', entries: ['#201/cause', '#203/duplicate'], reason: 'Same guard.' },
      ],
      ownership: [{ entry: '#203/ownership', layer: 201, reason: 'The helper is there.' }],
      derived: [
        {
          id: 'derived1',
          title: 'Remove the stale counter',
          plan: 'Delete the counter.',
          kind: 'simplification',
          effort: 'small',
          layer: 202,
          from: ['#201/cause', '#202/chain'],
        },
      ],
    },
  )
  session.pass!.contested = [
    'chain #201/cause',
    'duplicate #201/cause',
    'ownership #203/ownership',
    'derived derived1',
  ]
  renderPage(session)
  await screen.findByRole('heading', { name: 'Needs your answer · 4' })
  for (const [title, question] of [
    ['Finding chain on #202', 'Still make this change?'],
    ['Finding duplicate on #203', 'Make it separately?'],
    ['Finding ownership on #203', 'Which layer does this change belong on'],
    ['Remove the stale counter', 'Make this change?'],
  ] as const) {
    const card = screen.getByRole('heading', { name: title }).closest('article')!
    const doubt = within(card).getByText(
      (text, element) => element?.parentElement === card && text.includes(question),
    )
    expect(doubt.textContent).toContain('The second model did not approve')
    expect(within(card).getByText('Evidence and history').closest('details')?.open).toBe(false)
  }
})

it('copies the whole agent brief even when a layer is selected', async () => {
  const writeText = vi.fn(() => Promise.resolve())
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const session = renderPage()
  const rail = await screen.findByRole('navigation', { name: 'Filter review by layer' })
  fireEvent.click(within(rail).getByRole('button', { name: /#203/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Copy full brief' }))
  await waitFor(() => {
    expect(writeText).toHaveBeenCalledWith(
      stackBriefMarkdown(stackBrief(session)!, session.repository),
    )
  })
})
