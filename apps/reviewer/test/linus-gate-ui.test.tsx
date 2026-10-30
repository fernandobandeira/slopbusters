// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as routes from '../shared/api'
import type { ApiContract } from '../shared/api/contract'
import type { LinusSession } from '../shared/domain/linus'
import { Provider } from '../shared/domain/types'
import { LinusCompanion } from '../src/features/linus/LinusCompanion'
import { LinusRecommendationBadge } from '../src/features/linus/LinusRecommendationBadge'
import { PanelPicker } from '../src/features/panel/PanelPicker'
import { call } from '../src/lib/api'
import { linusAdvice, linusSession, pull } from './fixtures/chatSessions'

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  call: vi.fn(),
}))
vi.mock('../src/app/ThemeProvider', () => ({
  useReviewerTheme: () => ({ themeId: 'nord', setTheme: vi.fn(), error: '' }),
}))

const repository = 'review-room/example'
const thenPanel = { reviewers: ['unclebob' as const, 'terminator' as const] }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

function serve(
  sessions: Record<string, LinusSession>,
  handlers: Partial<Record<string, unknown>> = {},
) {
  vi.mocked(call).mockImplementation((route: ApiContract, input) => {
    if (route === routes.listTeammates) return Promise.resolve({ teammates: [] })
    if (route === routes.getLinus) {
      const id = (input as { params: { id: string } }).params.id
      return Promise.resolve(sessions[id])
    }
    const handler = handlers[route.path + route.method]
    if (typeof handler === 'function')
      return Promise.resolve((handler as (input: unknown) => unknown)(input))
    return Promise.reject(new Error(`Unexpected ${route.method} ${route.path}`))
  })
}

describe('asking Linus before the panel', () => {
  it('starts Linus with the chosen reviewers instead of the panel, and remembers the choice', async () => {
    const started = vi.fn(() => linusSession({ id: 'linus-2', status: 'running', results: [] }))
    serve({}, { [routes.startLinus.path + routes.startLinus.method]: started })
    const onOpen = vi.fn()
    const onLinus = vi.fn()
    render(
      <MemoryRouter>
        <PanelPicker
          repository={repository}
          pull={{ url: pull.url, number: pull.number }}
          provider={Provider.codex}
          onOpen={onOpen}
          onLinus={onLinus}
          openOnMount
        />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('checkbox', { name: /Ask Linus first/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask Linus, then review with 2 reviewers' }))

    await waitFor(() => {
      expect(onLinus).toHaveBeenCalledWith('linus-2')
    })
    expect(started).toHaveBeenCalledWith({
      body: {
        repository,
        urls: [pull.url],
        thenPanel: {
          reviewers: [
            { id: 'unclebob', providers: [Provider.codex] },
            { id: 'terminator', providers: [Provider.codex] },
          ],
        },
      },
    })
    expect(onOpen).not.toHaveBeenCalled()
    expect(localStorage.getItem('slopbusters:panel-linus-first')).toBe('true')
  })

  it('offers the panel alone where Linus cannot go first', async () => {
    serve({})
    render(
      <MemoryRouter>
        <PanelPicker
          repository={repository}
          pull={{ url: pull.url, number: pull.number }}
          provider={Provider.codex}
          onOpen={vi.fn()}
          openOnMount
        />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: 'Review with 2 reviewers' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: /Ask Linus first/ })).toBeNull()
  })
})

function renderCompanion(
  session: LinusSession,
  props: Partial<Parameters<typeof LinusCompanion>[0]> = {},
) {
  return render(
    <MemoryRouter>
      <LinusCompanion repository={repository} pulls={[]} sessionId={session.id} {...props} />
    </MemoryRouter>,
  )
}

describe('a PR Linus would split while the panel waits', () => {
  it('says the panel is waiting, and sends the PR on as one when the author says so', async () => {
    const waiting = linusSession({ thenPanel })
    const sent = linusSession({
      thenPanel,
      results: waiting.results.map((result) => ({ ...result, panelSessionId: 'panel-9' })),
    })
    const sendOn = vi.fn(() => sent)
    serve(
      { [waiting.id]: waiting },
      { [routes.startLinusPanel.path + routes.startLinusPanel.method]: sendOn },
    )
    const onOpenPanel = vi.fn()
    renderCompanion(waiting, { onOpenPanel })

    expect(await screen.findByText('The panel is waiting on you.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review as one PR' }))

    expect(
      await screen.findByText(`The panel is reviewing PR #${String(pull.number)} as one PR.`),
    ).toBeTruthy()
    expect(sendOn).toHaveBeenCalledWith({ params: { id: waiting.id }, body: { url: pull.url } })
    fireEvent.click(screen.getByRole('button', { name: 'Open the panel' }))
    expect(onOpenPanel).toHaveBeenCalledWith(pull.url, 'panel-9')
  })

  it('asks Linus again with the author’s guidance and the same panel to follow', async () => {
    const waiting = linusSession({ thenPanel })
    const again = linusSession({ id: 'linus-2', thenPanel, status: 'running', results: [] })
    const start = vi.fn(() => again)
    serve(
      { [waiting.id]: waiting, [again.id]: again },
      { [routes.startLinus.path + routes.startLinus.method]: start },
    )
    const onSessionStarted = vi.fn()
    renderCompanion(waiting, { onSessionStarted })

    fireEvent.click(await screen.findByRole('button', { name: 'Tell Linus more' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'The audit entry ships with the rule; the log is read by the same screen.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ask Linus again' }))

    await waitFor(() => {
      expect(onSessionStarted).toHaveBeenCalledWith('linus-2')
    })
    expect(start).toHaveBeenCalledWith({
      body: {
        repository,
        urls: [pull.url],
        guidance: 'The audit entry ships with the rule; the log is read by the same screen.',
        thenPanel,
      },
    })
  })
})

describe('a PR Linus reviewed without a decision to make', () => {
  it('shows the panel that followed a PR Linus kept, and nothing to decide', async () => {
    const kept = linusSession({
      thenPanel,
      results: [
        {
          pull,
          fingerprint: 'f',
          advice: { ...linusAdvice, verdict: 'keep', layers: [] },
          reviewers: [],
          panelSessionId: 'panel-3',
        },
      ],
    })
    serve({ [kept.id]: kept })
    renderCompanion(kept)

    expect(
      await screen.findByText(`The panel is reviewing PR #${String(pull.number)}.`),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review as one PR' })).toBeNull()
  })

  it('leaves a plain Linus review without any panel talk', async () => {
    const plain = linusSession()
    serve({ [plain.id]: plain })
    renderCompanion(plain)

    expect(await screen.findByText('Two changes share one PR.')).toBeTruthy()
    expect(screen.queryByText(/The panel is/)).toBeNull()
  })

  it('marks the PR row while the panel waits on the author', () => {
    render(
      <LinusRecommendationBadge
        recommendation={{
          sessionId: 'linus-1',
          createdAt: '',
          url: pull.url,
          number: pull.number,
          headSha: pull.headSha,
          verdict: 'stack',
          recommendationCount: 1,
          panel: 'waiting',
        }}
        headSha={pull.headSha}
        onOpen={vi.fn()}
      />,
    )

    const badge = screen.getByRole('button', { name: /Open Linus recommendations/ })
    expect(badge.textContent).toContain('Panel waiting')
    expect(badge.getAttribute('aria-label')).toContain('The panel is waiting on you.')
  })
})
