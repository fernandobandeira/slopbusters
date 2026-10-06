// @vitest-environment happy-dom
import { GandalfCompanion } from '../src/features/gandalf/GandalfCompanion'
import { BobCompanion } from '../src/features/bob/BobCompanion'
import { LinusCompanion } from '../src/features/linus/LinusCompanion'
import { fixturePull } from './fixtures/pull'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentSessionCard } from '../src/features/agent-sessions/AgentSessionCard'
import { SessionsPage } from '../src/features/agent-sessions/SessionsPage'
import { SessionMarkdown } from '~/components/chat/SessionMarkdown'
import { Provider } from '../shared/domain/types'
import type { AgentRun, AgentEvent } from '../shared/domain/agentSession'

const root = {
  id: 'session',
  kind: 'gandalf',
  repository: 'example/project',
  urls: ['https://github.com/example/project/pull/1'],
  status: 'running',
  progress: 'Reviewing resolution',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}
const first: AgentRun = {
  id: 'primary',
  sessionId: root.id,
  model: { provider: Provider.codex, model: 'gpt-6.1-sol' },
  label: 'Primary review',
  status: 'complete',
  startedAt: root.createdAt,
}
const second: AgentRun = {
  ...first,
  id: 'secondary',
  url: 'https://github.com/example/project/pull/2',
  model: { provider: Provider.claude, model: 'claude-opus-5-5' },
  label: 'Secondary review',
  status: 'running',
}
const session = { ...root, runs: [first, second] }
const event = (text: string): AgentEvent => ({
  id: 'answer',
  kind: 'assistant',
  text,
  sequence: 1,
  position: 1,
})
const transcript = (run: AgentRun, text: string) => ({
  run: { ...run, status: 'complete' },
  events: [event(text)],
  cursor: 1,
  more: false,
})
function fetchSessions() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = requestUrl(input)
    if (url.includes('/runs/primary'))
      return Promise.resolve(Response.json(transcript(first, 'Primary findings')))
    if (url.includes('/runs/secondary'))
      return Promise.resolve(Response.json(transcript(second, 'Secondary findings')))
    if (url.includes('/agent-sessions/session')) return Promise.resolve(Response.json(session))
    return Promise.resolve(Response.json({ sessions: [session] }))
  })
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows a running model card linked to its session', async () => {
  vi.stubGlobal('fetch', fetchSessions())
  render(
    <MemoryRouter>
      <AgentSessionCard sessionId="session" repository="example/project" />
    </MemoryRouter>,
  )
  const card = await screen.findByRole('link', { name: /Gandalf.*running.*Claude Opus 5.5/ })
  expect(card.getAttribute('href')).toBe('/sessions/session?repository=example%2Fproject')
})
it('opens the current pass and lets the user revisit a previous model run', async () => {
  vi.stubGlobal('fetch', fetchSessions())
  render(
    <MemoryRouter initialEntries={['/sessions/session']}>
      <SessionsPage id="session" repository="example/project" />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Secondary findings')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open PR' }).getAttribute('href')).toContain('/pulls/2')
  fireEvent.click(screen.getByRole('link', { name: /Codex Sol 6.1.*Primary review/ }))
  expect(await screen.findByText('Primary findings')).toBeTruthy()
  expect(screen.queryByText('Secondary findings')).toBeNull()
  expect(
    screen
      .getByRole('link', { name: /Codex Sol 6.1.*Primary review/ })
      .getAttribute('aria-current'),
  ).toBe('page')
})
it('ignores a late transcript response after selecting a different pass', async () => {
  const fetcher = fetchSessions()
  let finish!: (response: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      requestUrl(input).includes('/runs/secondary')
        ? new Promise<Response>((resolve) => {
            finish = resolve
          })
        : fetcher(input),
    ),
  )
  render(
    <MemoryRouter initialEntries={['/sessions/session']}>
      <SessionsPage id="session" />
    </MemoryRouter>,
  )
  await waitFor(() => {
    expect(finish).toBeTypeOf('function')
  })
  fireEvent.click(screen.getByRole('link', { name: /Codex Sol 6.1.*Primary review/ }))
  await screen.findByText('Primary findings')
  finish(Response.json(transcript(second, 'Late secondary output')))
  await waitFor(() => {
    expect(screen.queryByText('Late secondary output')).toBeNull()
  })
})
it('explains failures that happen before any provider starts', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          ...session,
          runs: [],
          status: 'failed',
          progress: 'Stopped',
          failureContext: 'Preparing conflicts for PR #1',
          error: 'Could not prepare conflicts.',
        }),
      ),
    ),
  )
  render(
    <MemoryRouter>
      <SessionsPage id="session" />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Stopped during: Preparing conflicts for PR #1')).toBeTruthy()
  expect(screen.getByText('The session stopped before a model pass started.')).toBeTruthy()
})
it('sanitizes model Markdown and avoids loading remote images', () => {
  const { container } = render(
    <SessionMarkdown
      text={
        '<script>alert(1)</script><img src="https://example.com/pixel" onerror="alert(1)">\n\n[bad](javascript:alert(1))\n\n**Useful finding**'
      }
    />,
  )
  expect(container.querySelector('script')).toBeNull()
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('a')?.getAttribute('href')).toBeNull()
  expect(screen.getByText('Useful finding')).toBeTruthy()
})

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

it.each(['gandalf', 'bob', 'linus'] as const)(
  'keeps the %s session card inside its own chat bubble',
  async (kind) => {
    const job = { ...root, primary: first.model, companion: second.model, turns: [], results: [] }
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = requestUrl(input)
        return Promise.resolve(
          Response.json(
            url.includes('/agent-sessions')
              ? { sessions: [{ ...session, kind }] }
              : url.includes('/latest')
                ? { session: job }
                : job,
          ),
        )
      }),
    )
    const renderSessionCard = (sessionId: string) => (
      <AgentSessionCard sessionId={sessionId} repository={root.repository} />
    )
    const companions = {
      gandalf: (
        <GandalfCompanion
          repository={root.repository}
          pulls={[]}
          ready
          onClose={vi.fn()}
          onComplete={vi.fn()}
          renderSessionCard={renderSessionCard}
        />
      ),
      bob: (
        <BobCompanion
          pull={{ ...fixturePull(), owner: 'example', repo: 'project', url: root.urls[0] ?? '' }}
          draft={{ viewedFileIds: [], comments: [], summary: '' }}
          setDraft={vi.fn()}
          ready
          openReview={vi.fn()}
          focusLine={vi.fn()}
          replaySessionId={root.id}
          renderSessionCard={renderSessionCard}
        />
      ),
      linus: (
        <LinusCompanion
          repository={root.repository}
          pulls={[]}
          available={false}
          sessionId={root.id}
          renderSessionCard={renderSessionCard}
        />
      ),
    }
    render(<MemoryRouter>{companions[kind]}</MemoryRouter>)
    const card = await screen.findByRole('link', { name: /Claude Opus 5.5/ })
    expect(card.closest('.gandalf-bubble, .linus-bubble')).not.toBeNull()
    expect(card.getAttribute('href')).toBe('/sessions/session?repository=example%2Fproject')
  },
)
