// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import type { ApiContract } from '../shared/api/contract'
import type { PanelSession } from '../shared/domain/panel'
import { Provider, type ReviewDraft } from '../shared/domain/types'
import { PanelCompanion } from '../src/features/panel/PanelCompanion'
import { call } from '../src/lib/api'
import { fixtureJudgeAdvice, fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
import { fixturePull } from './fixtures/pull'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  call: vi.fn(),
}))

const pull = fixturePull()
function session(): PanelSession {
  const advice = fixtureJudgeAdvice(['teammate:avery', 'unclebob'])
  advice.findings = [
    {
      ...fixturePanelFinding({
        tag: 'decision',
        title: 'Who may edit archived projects?',
        body: 'Should editors still update an archived project?',
        suggestion: 'Block archived projects.',
      }),
      raisedBy: ['teammate:avery', 'unclebob'],
    },
  ]
  advice.setAside = [
    {
      title: 'Rename canEditProject',
      body: 'A shorter name reads better.',
      raisedBy: ['unclebob'],
      reason: 'Taste with no rule behind it.',
    },
  ]
  return {
    id: 'panel-1',
    repository: 'review-room/example',
    urls: [pull.url],
    model: { provider: Provider.claude, model: 'claude-opus-5-5' },
    reviewers: [
      { id: 'unclebob', name: 'Uncle Bob', maxFindings: 10 },
      { id: 'teammate:avery', name: 'Avery', skill: 'AveryReview', maxFindings: 16 },
    ],
    status: 'complete',
    progress: 'The panel reviewed 1 PR.',
    createdAt: '',
    results: [
      {
        pull,
        fingerprint: 'f',
        advice,
        reviews: [
          { reviewer: 'unclebob', advice: fixturePanelAdvice() },
          { reviewer: 'teammate:avery', advice: fixturePanelAdvice() },
        ],
      },
    ],
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.mocked(call).mockImplementation((route: ApiContract) => {
    if (route === routes.getPanel) return Promise.resolve(session())
    if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
    return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the review panel companion', () => {
  it('shows the judged summary, then a decision as a question whose comment has no fix', async () => {
    let draft: ReviewDraft = { comments: [], summary: '', viewedFileIds: [] }
    render(
      <MemoryRouter>
        <PanelCompanion
          sessionId="panel-1"
          pull={pull}
          draft={draft}
          setDraft={(action) => {
            draft = action(draft)
          }}
          ready
          openReview={vi.fn()}
          focusLine={vi.fn()}
          onOpen={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: 'Changes to make' })).toBeTruthy()
    expect(screen.getByText('Set aside by the judge · 1')).toBeTruthy()
    expect(screen.getByText('Set aside: Taste with no rule behind it.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))

    expect(screen.getByRole('heading', { name: 'Who may edit archived projects?' })).toBeTruthy()
    expect(screen.getByText('Should fix · Question for the author')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Raised by Avery, Uncle Bob' })).toBeTruthy()
    expect(screen.queryByText('Block archived projects.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add review comment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save to review draft' }))

    expect(draft.comments).toEqual([
      expect.objectContaining({
        body: 'Who may edit archived projects?\n\nShould editors still update an archived project?',
        path: fixturePanelFinding().path,
      }),
    ])
  })
})
