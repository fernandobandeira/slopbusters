import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, vi } from 'vitest'
import * as routes from '../../shared/api'
import * as recordRoutes from '../../shared/api/stackReviewRecords'
import { latestLayerFix } from '../../shared/api/layerFix'
import type { ApiContract } from '../../shared/api/contract'
import { stackBrief } from '../../shared/domain/stackBrief'
import type { StackRecord } from '../../shared/domain/stackReviewRecords'
import { Provider } from '../../shared/domain/types'
import { renderStackStart } from '../../src/app/StackReviewSlot'
import { StackReviewPage } from '../../src/features/stack-review/StackReviewPage'
import { call } from '../../src/lib/api'
import { stackDecisionRecord } from './stackDecisionRecord'
import { finishedStackReview, layerUrl, stackEntry } from './stackReview'

export function savedReview() {
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

export function renderPage(session = savedReview()) {
  const brief = stackBrief(session)!
  const records = new Map<string, StackRecord>()
  const response = () =>
    Promise.resolve({ records: [...records.values()], revisions: [], applied: [] })
  function save(
    id: string,
    answer: recordRoutes.AnswerWrite['answer'] | null,
    expectedRevision: number,
  ) {
    const decision = brief.decisions.find((item) => item.id === id)!
    records.set(id, stackDecisionRecord(brief, decision, answer, expectedRevision + 1))
  }
  vi.mocked(call).mockImplementation((route: ApiContract, input: { body?: unknown }) => {
    if (route === recordRoutes.getStackRecords) return response()
    if (route === recordRoutes.putStackAnswer) {
      const { decisionId, answer, expectedRevision } = recordRoutes.putStackAnswer.request.parse(
        input.body,
      )
      save(decisionId, answer, expectedRevision)
      return response()
    }
    if (route === recordRoutes.reopenStackAnswer) {
      const { decisionId, expectedRevision } = recordRoutes.reopenStackAnswer.request.parse(
        input.body,
      )
      save(decisionId, null, expectedRevision)
      return response()
    }
    if (route === recordRoutes.putStackAnswers) {
      const { answers } = recordRoutes.putStackAnswers.request.parse(input.body)
      for (const { decisionId, optionId, expectedRevision } of answers)
        save(
          decisionId,
          { state: 'chosen', optionId, reply: 'The code shows it.' },
          expectedRevision,
        )
      return response()
    }
    if (route === routes.latestStackReview) return Promise.resolve({ session })
    if (route === latestLayerFix)
      return Promise.resolve({ session: null, availability: { applied: [] }, retryable: false })
    return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
  })
  render(
    <MemoryRouter>
      <StackReviewPage
        url={layerUrl(202)}
        renderStart={renderStackStart(Provider.codex)}
        backPath="/pull"
      />
    </MemoryRouter>,
  )
  return { session, records, brief, response }
}

export async function enabledButton(
  name: string,
  scope: Pick<typeof screen, 'findByRole'> = screen,
) {
  const button = await scope.findByRole('button', { name })
  await waitFor(() => {
    expect(button).toHaveProperty('disabled', false)
  })
  return button
}
