// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../../../../shared/api'
import type { ApiContract } from '../../../../shared/api/contract'
import { selectCandidates, type ResolvedEntry } from '../../../../shared/domain/grounding'
import type { GateItem } from '../../../../shared/domain/panelGate'
import type { PanelResult, PanelSession } from '../../../../shared/domain/panelSession'
import { Provider } from '../../../../shared/domain/types'
import { PanelDestinations } from '../../../../src/features/panel/PanelDestinations'
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

function entry(id: string, source: string, changes: Partial<ResolvedEntry>): ResolvedEntry {
  return {
    id,
    sources: [source],
    verdict: 'legit',
    reason: 'The helper already exists.',
    evidence: ['src/audit.ts:4'],
    plan: 'Reuse it.',
    destination: { kind: 'code', pull: pull.number },
    resolution: 'agreed',
    raisedBy: ['unclebob'],
    ...changes,
  }
}

function result(): PanelResult {
  const advice = fixturePanelAdvice([
    fixturePanelFinding({ id: 'layer', title: 'Move the guard to the API layer' }),
    fixturePanelFinding({ id: 'old', title: 'The old screen says three days' }),
  ])
  const resolved = [
    entry('g1', 'f1', { destination: { kind: 'code', pull: 13 } }),
    entry('g2', 'f2', { origin: 'preexisting', reason: 'It predates this PR.' }),
  ]
  return {
    pull,
    fingerprint: 'f',
    advice: fixtureJudgeAdvice(['unclebob']),
    reviews: [],
    grounding: {
      budget: 40,
      candidates: selectCandidates(pull.number, [{ reviewer: 'unclebob', advice }], 40),
      roles: { primary: { provider: Provider.claude, model: 'claude-fable-5-1' } },
      turns: [],
      entries: resolved,
      positions: {},
      resolved,
    },
  }
}

const session = { id: 'panel-1', results: [result()] } as PanelSession
const ready: GateItem[] = [
  {
    entry: result().grounding?.resolved?.[0] as ResolvedEntry,
    action: { entry: 'g1', selected: true },
    plan: 'Reuse it.',
    route: { kind: 'layer', pull: 13 },
  },
]

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ready work that does not go to this PR’s fix thread', () => {
  it('grounds another layer’s finding there, then opens that round', async () => {
    const onOpen = vi.fn()
    const routed = {
      ...session,
      results: [
        {
          ...result(),
          routed: [{ pull: 13, session: 'layer-round', entries: ['g1'], createdAt: '' }],
        },
      ],
    }
    vi.mocked(call).mockImplementation((route: ApiContract) =>
      route === routes.routePanelLayer
        ? Promise.resolve(routed)
        : Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`)),
    )
    let current = result()
    const view = () => (
      <PanelDestinations
        session={session}
        result={current}
        ready={ready}
        replace={(next) => {
          current = next.results[0] as PanelResult
        }}
        onOpen={onOpen}
      />
    )
    const { rerender } = render(view())

    fireEvent.click(
      screen.getByRole('button', { name: 'Ground 1 finding on PR #13 with the same panel' }),
    )
    await vi.waitFor(() => {
      expect(current.routed).toHaveLength(1)
    })
    rerender(view())
    fireEvent.click(screen.getByRole('button', { name: 'Open PR #13’s round' }))

    expect(onOpen).toHaveBeenCalledWith('layer-round')
  })

  it('offers problems that were there before this PR as follow-ups to copy', () => {
    render(
      <PanelDestinations
        session={session}
        result={result()}
        ready={[]}
        replace={vi.fn()}
        onOpen={vi.fn()}
      />,
    )

    expect(screen.getByText(/1 already there · follow-up/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy the follow-ups' })).toBeTruthy()
  })
})
