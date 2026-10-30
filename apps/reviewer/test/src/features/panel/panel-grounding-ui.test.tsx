// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import {
  selectCandidates,
  type GroundingOrigin,
  type GroundingState,
} from '../../../../shared/domain/grounding'
import {
  groundedAdvice,
  recordTurn,
  resolveEntries,
} from '../../../../shared/domain/groundingResult'
import { gateRevision } from '../../../../shared/domain/panelGate'
import type { PanelSession } from '../../../../shared/domain/panelSession'
import { PanelCompanion } from '../../../../src/features/panel/PanelCompanion'
import { call } from '../../../../src/lib/api'
import { fixturePanelAdvice, fixturePanelFinding } from '../../../fixtures/panel'
import { companion, primary } from '../../../fixtures/panelJobs'
import { fixturePull } from '../../../fixtures/pull'

vi.mock('../../../../src/lib/api', async (original) => ({
  ...(await original<typeof import('../../../../src/lib/api')>()),
  call: vi.fn(),
}))

const pull = fixturePull()

/** Avery raised two findings and Uncle Bob one; the round grounded two and deferred one. */
function grounded(origin: GroundingOrigin = 'change'): GroundingState {
  const avery = fixturePanelAdvice([
    fixturePanelFinding({ id: 'audit', title: 'Reuse the audit helper' }),
    fixturePanelFinding({ id: 'rename', title: 'Rename the guard' }),
  ])
  const bob = fixturePanelAdvice([fixturePanelFinding({ id: 'guard', title: 'Guard is unused' })])
  const state: GroundingState = {
    budget: 2,
    candidates: selectCandidates(
      pull.number,
      [
        { reviewer: 'teammate:avery', advice: avery },
        { reviewer: 'unclebob', advice: bob },
      ],
      2,
    ),
    roles: { primary, secondary: companion },
    turns: [],
    entries: [],
    positions: {},
  }
  const reply = {
    entries: [
      {
        id: 'g1',
        sources: ['f1'],
        verdict: 'legit' as const,
        reason: 'The helper already writes the audit row.',
        evidence: ['src/audit.ts:4'],
        plan: 'Call writeAudit instead of the inline insert.',
        origin,
        destination: { kind: 'code' as const, pull: pull.number },
      },
      {
        id: 'g2',
        sources: ['f2'],
        verdict: 'notTrue' as const,
        reason: 'The guard is called by the editor route.',
        evidence: ['src/routes/editor.ts:18'],
        origin: 'change' as const,
        destination: { kind: 'code' as const, pull: pull.number },
      },
    ],
    approved: true,
    summary: 'Reuse the audit helper.',
    objections: [],
  }
  recordTurn(state, { role: 'primary', model: primary, reply: { ...reply, approved: false } })
  recordTurn(state, { role: 'secondary', model: companion, reply })
  recordTurn(state, { role: 'primary', model: primary, reply })
  state.outcome = 'agreed'
  state.resolved = resolveEntries(state, (key) => (key === 'f2' ? 'unclebob' : 'teammate:avery'))
  return state
}

function session(origin?: GroundingOrigin): PanelSession {
  const grounding = grounded(origin)
  return {
    id: 'panel-1',
    repository: 'review-room/example',
    urls: [pull.url],
    model: primary,
    companion,
    reviewers: [
      { id: 'unclebob', name: 'Uncle Bob', maxFindings: 10 },
      { id: 'teammate:avery', name: 'Avery', skill: 'AveryReview', maxFindings: 40 },
    ],
    status: 'complete',
    progress: 'The panel reviewed 1 PR.',
    createdAt: '',
    results: [
      {
        pull,
        fingerprint: 'f',
        advice: groundedAdvice(grounding, { summary: 'Reuse the audit helper.', limitations: [] }),
        reviews: [],
        grounding,
      },
    ],
  }
}

afterEach(() => {
  localStorage.clear()
  cleanup()
  vi.clearAllMocks()
})

describe('a grounded panel result', () => {
  it('shows how every finding was accounted for, then each verdict with its plan', async () => {
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.getPanel) return Promise.resolve(session())
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
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

    expect(await screen.findByRole('heading', { name: 'Reuse the audit helper' })).toBeTruthy()
    expect(
      screen.getByText('Worth fixing · Both models agree · Caused by this change'),
    ).toBeTruthy()
    expect(screen.getByText('Call writeAudit instead of the inline insert.')).toBeTruthy()
    expect(screen.getByText('src/audit.ts:4')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))

    expect(screen.getByRole('heading', { name: 'Changes to make' })).toBeTruthy()
    expect(screen.getByText('3 returned · 2 grounded · 1 deferred · 2 agreed')).toBeTruthy()
    expect(screen.getByText('Worth fixing 1 · Not true 1')).toBeTruthy()
    expect(screen.getByText('Rejected by both models · 1')).toBeTruthy()
    expect(
      screen.getByText('Set aside: Not true: The guard is called by the editor route.'),
    ).toBeTruthy()
    expect(screen.getByText('Deferred to a later round · 1')).toBeTruthy()
    expect(screen.getByText('Rename the guard')).toBeTruthy()
  })
})

describe('a problem that was there before this PR', () => {
  it('is kept apart as a follow-up and left unticked', async () => {
    vi.mocked(call).mockImplementation((route: ApiContract) => {
      if (route === routes.getPanel) return Promise.resolve(session('preexisting'))
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Choose fixes' }))

    expect(screen.getByText('Already there · follow-ups · 1')).toBeTruthy()
    expect(screen.queryByText(/^Worth fixing · \d/)).toBeNull()
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Reuse the audit helper' }).checked,
    ).toBe(false)
  })
})

describe('choosing fixes', () => {
  it('starts with the agreed fix ticked and needs a plan before a rejection can be sent', async () => {
    const saved: unknown[] = []
    vi.mocked(call).mockImplementation((route: ApiContract, options?: unknown) => {
      if (route === routes.getPanel) return Promise.resolve(session())
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      if (route === routes.savePanelGate) {
        const { body } = options as { body: { gate: PanelSession['results'][number]['gate'] } }
        saved.push(body.gate)
        const next = session()
        if (next.results[0]) next.results[0].gate = body.gate
        return Promise.resolve(next)
      }
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Choose fixes' }))
    expect(screen.getByText('1 ready to fix')).toBeTruthy()
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Reuse the audit helper' }).checked,
    ).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Guard is unused' }))

    expect(await screen.findByText('1 ready to fix · 1 blocked')).toBeTruthy()
    expect(screen.getByText(/rejected this finding; write the plan/)).toBeTruthy()
    const plans = screen.getAllByPlaceholderText('What the fix should change')
    fireEvent.change(plans[1] as HTMLElement, { target: { value: 'Delete the guard.' } })
    fireEvent.blur(plans[1] as HTMLElement)

    expect(await screen.findByText('2 ready to fix')).toBeTruthy()
    expect(saved.at(-1)).toEqual({
      actions: [
        { entry: 'g1', selected: true },
        { entry: 'g2', selected: true, plan: 'Delete the guard.', planBy: 'author' },
      ],
    })
  })
})

describe('proceeding with the chosen fixes', () => {
  it('saves the choices, sends them from that saved revision, and says where they went', async () => {
    const proceeded: unknown[] = []
    vi.mocked(call).mockImplementation((route: ApiContract, options?: unknown) => {
      if (route === routes.getPanel) return Promise.resolve(session())
      if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
      if (route === routes.savePanelGate) return Promise.resolve(session())
      if (route === routes.proceedPanelFixes) {
        proceeded.push((options as { body: unknown }).body)
        const sent = session()
        if (sent.results[0])
          sent.results[0].handoff = {
            revision: 'gate:1',
            threadId: 'thread-1',
            state: 'sent',
            createdAt: '',
            entries: ['g1'],
            launch: {
              title: 'Fix PR #12: 1 panel fix',
              project: 'example',
              location: 't3code',
              branch: 'slopbusters/fix-12-a7f239d',
              worktreePath: '/fixes/12',
              reviewedSha: pull.headSha,
              baseSha: pull.baseSha,
            },
          }
        return Promise.resolve(sent)
      }
      return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
    })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Choose fixes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send 1 fix to a fix thread' }))

    expect(await screen.findByText(/Sent 1 fix to “Fix PR #12: 1 panel fix”/)).toBeTruthy()
    expect(screen.getByText('slopbusters/fix-12-a7f239d')).toBeTruthy()
    expect(proceeded).toEqual([{ url: pull.url, revision: gateRevision('f', undefined) }])
  })
})
