// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import type { PanelFinding } from '../../../../shared/domain/panel'
import type { PanelSession } from '../../../../shared/domain/panelSession'
import { Provider, type ReviewDraft } from '../../../../shared/domain/types'
import { PanelCompanion } from '../../../../src/features/panel/PanelCompanion'
import { call } from '../../../../src/lib/api'
import {
  fixtureJudgeAdvice,
  fixturePanelAdvice,
  fixturePanelFinding,
} from '../../../fixtures/panel'
import { fixturePull } from '../../../fixtures/pull'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))

const pull = fixturePull()
function anchorPath({ anchor }: PanelFinding) {
  return anchor.kind === 'change' || anchor.kind === 'context' ? anchor.path : undefined
}
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
          {
            reviewer: 'teammate:avery',
            advice: fixturePanelAdvice(),
            unplaced: [
              {
                finding: fixturePanelFinding({ id: 'gone', title: 'Update the old caller' }),
                problem: 'src/gone.ts is not in the snapshot or the reviewed source.',
              },
            ],
          },
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

    expect(
      await screen.findByRole('heading', { name: 'Who may edit archived projects?' }),
    ).toBeTruthy()
    expect(screen.getByText('Should fix · Question for the author')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Raised by Avery, Uncle Bob' })).toBeTruthy()
    expect(screen.queryByText('Block archived projects.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(draft.comments).toEqual([
      expect.objectContaining({
        body: 'Who may edit archived projects?\n\nShould editors still update an archived project?',
        path: anchorPath(fixturePanelFinding()),
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))

    expect(screen.getByRole('heading', { name: 'Changes to make' })).toBeTruthy()
    expect(screen.getByText('Set aside by the judge · 1')).toBeTruthy()
    expect(screen.getByText('Set aside: Taste with no rule behind it.')).toBeTruthy()
    expect(screen.getByText('Not placed in this snapshot · 1')).toBeTruthy()
    expect(
      screen.getByText('src/gone.ts is not in the snapshot or the reviewed source.'),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy review' })).toBeTruthy()
  })
})

describe('a review of commits the PR has moved past', () => {
  it('says so above the findings, keeps comments off, and reviews the current commits', async () => {
    const current = { ...pull, headSha: 'b'.repeat(40) }
    const onOpen = vi.fn()
    const focusLine = vi.fn()
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.getPanel) return Promise.resolve(session())
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      if (route === routes.startPanel) return Promise.resolve({ ...session(), id: 'panel-2' })
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    render(
      <MemoryRouter>
        <PanelCompanion
          sessionId="panel-1"
          pull={current}
          draft={{ comments: [], summary: '', viewedFileIds: [] }}
          setDraft={vi.fn()}
          ready
          openReview={vi.fn()}
          focusLine={focusLine}
          onOpen={onOpen}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(await screen.findByText('New commits since this review.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept' })).toHaveProperty('disabled', true)
    expect(focusLine).not.toHaveBeenCalledWith(expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Review the current PR' }))

    await vi.waitFor(() => {
      expect(onOpen).toHaveBeenCalledWith('panel-2')
    })
    const started = vi.mocked(call).mock.calls.find(([route]) => route === routes.startPanel)
    expect(started?.[1]).toMatchObject({ body: { urls: [pull.url] } })
  })
})

describe('a finding without a line', () => {
  it('adds a finding about the PR description to the review summary, not to a line', async () => {
    const described = session()
    described.results[0]?.advice.findings.push({
      ...fixturePanelFinding({
        id: 'describe-roles',
        title: 'Say which roles changed',
        body: 'The description does not mention viewers.',
        anchor: { kind: 'description', field: 'description' },
      }),
      raisedBy: ['teammate:avery'],
    })
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.getPanel) return Promise.resolve(described)
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
    let draft: ReviewDraft = { comments: [], summary: 'Looks close.', viewedFileIds: [] }
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

    await screen.findByRole('heading', { name: 'Who may edit archived projects?' })
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(screen.getByText('PR description')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))

    expect(draft.comments).toEqual([])
    expect(draft.summary).toMatch(
      /^Looks close\.\n\n<!-- panel:\w+ -->\n\*\*PR description\*\*\n\nSay which roles changed\n\nThe description does not mention viewers\./,
    )
  })
})

describe('the review panel portrait', () => {
  it('stacks every reviewer once while the panel runs, each face showing its state', async () => {
    const running: PanelSession = {
      ...session(),
      status: 'running',
      results: [],
      reviewers: [
        { id: 'unclebob@claude', name: 'Uncle Bob (Claude)', maxFindings: 10 },
        { id: 'unclebob@codex', name: 'Uncle Bob (Codex)', maxFindings: 10 },
        { id: 'terminator', name: 'Terminator', maxFindings: 10 },
      ],
      pending: {
        pull,
        fingerprint: 'f',
        reviews: [{ reviewer: 'terminator', advice: fixturePanelAdvice() }],
      },
    }
    vi.mocked(call).mockImplementation((route: ApiContract) =>
      route === routes.getPanel ? Promise.resolve(running) : Promise.resolve({ teammates: [] }),
    )
    render(
      <MemoryRouter>
        <PanelCompanion
          sessionId="panel-1"
          pull={pull}
          draft={{ comments: [], summary: '', viewedFileIds: [] }}
          setDraft={vi.fn()}
          ready
          openReview={vi.fn()}
          focusLine={vi.fn()}
          onOpen={vi.fn()}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )

    const stack = await screen.findByRole('img', { name: 'Uncle Bob and Terminator, reviewing' })
    const faces = [...stack.querySelectorAll('img')].map((face) => face.getAttribute('src'))
    expect(faces).toEqual(['/unclebob/thinking.png', '/terminator/neutral.png'])
    expect(screen.queryByAltText("The panel's judge")).toBeNull()
  })
})
