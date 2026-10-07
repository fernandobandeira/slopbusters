import { Provider } from '../../../shared/domain/types'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { OpenAI, ClaudeAI } from '~/components/ProviderLogos'
import type { AgentRun } from '../../../shared/domain/agentSession'
import { getAgentSession } from '../../../shared/api/agentSessions'
import { useApiQuery } from '../../lib/useApiQuery'
import { useAgentSessions } from './useAgentSessions'
import { agentNames, modelName, sessionPath } from './sessionPresentation'
import { AgentState } from './AgentState'
import { SessionTranscript } from './SessionTranscript'
import { reviewPath } from '../../lib/routes'
import './sessions.css'

export function SessionsPage({ id, repository }: { id?: string; repository?: string }) {
  return id ? (
    <SessionDetail id={id} repository={repository} />
  ) : (
    <SessionHistory repository={repository} />
  )
}

function useSessionDetail(id: string) {
  const detail = useApiQuery(getAgentSession, { params: { id } })
  const { reload } = detail
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) reload()
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [reload])
  return detail
}

function SessionDetail({ id, repository }: { id: string; repository?: string }) {
  const detail = useSessionDetail(id)
  const location = useLocation()
  const session = detail.data
  const selected = new URLSearchParams(location.search).get('run')
  if (detail.error)
    return (
      <div className="empty-state" role="alert">
        {detail.error}
        <Link to={sessionPath(undefined, repository)}>All sessions</Link>
      </div>
    )
  if (!session)
    return (
      <div className="empty-state" role="status">
        Loading session…
      </div>
    )
  const run = selectPass(session.runs, selected)
  const pullUrl = run?.url ?? session.urls[0]
  return (
    <div className="session-page">
      <header className="session-heading">
        <div>
          <Link to={sessionPath(undefined, repository)}>← All sessions</Link>
          <h2>
            {agentNames[session.kind]} · {session.repository}
          </h2>
        </div>
        <AgentState status={session.status} />
        {pullUrl && (
          <Link className="session-pr-link" to={reviewPath({ url: pullUrl, filter: 'mine' })}>
            Open PR
          </Link>
        )}
      </header>
      {session.status !== 'complete' && (
        <p className="session-progress" role="status">
          {session.progress}
        </p>
      )}
      {session.failureContext && (
        <p className="session-failure-context">Stopped during: {session.failureContext}</p>
      )}
      {session.error && (
        <p className="error-banner" role="alert">
          {session.error}
        </p>
      )}
      <div className="session-detail-layout">
        <nav className="session-pass-list" aria-label="Model passes">
          <h3>Model passes</h3>
          {session.runs.map((pass, index) => (
            <PassLink
              key={pass.id}
              run={pass}
              index={index}
              repository={session.repository}
              selected={run?.id === pass.id}
            />
          ))}
          {!session.runs.length && <p>No model pass started yet.</p>}
        </nav>
        {run ? (
          <SessionTranscript key={run.id} sessionId={session.id} run={run} />
        ) : (
          <div className="empty-state">
            {session.status === 'running'
              ? 'Preparing the first model pass…'
              : 'The session stopped before a model pass started.'}
          </div>
        )}
      </div>
    </div>
  )
}

function PassLink({
  run,
  index,
  repository,
  selected,
}: {
  run: AgentRun
  index: number
  repository: string
  selected: boolean
}) {
  const target = new URL(sessionPath(run.sessionId, repository), window.location.origin)
  target.searchParams.set('run', run.id)
  return (
    <Link
      className={`session-pass ${selected ? 'selected' : ''}`}
      aria-current={selected ? 'page' : undefined}
      to={target.pathname + target.search}
    >
      <div className="agent-model-line">
        {run.model.provider === Provider.codex ? (
          <OpenAI className="size-4" />
        ) : (
          <ClaudeAI className="size-4" />
        )}
        <strong>
          {run.model.provider === Provider.codex ? 'Codex' : 'Claude'} {modelName(run.model)}
        </strong>
      </div>
      <span>
        Pass {index + 1} · {run.label}
      </span>
      {run.url && <small>PR #{run.url.split('/').at(-1)}</small>}
      <AgentState status={run.status} />
    </Link>
  )
}

function SessionHistory({ repository }: { repository?: string }) {
  const list = useAgentSessions(repository)
  return (
    <div className="sessions-index">
      <header>
        <h1>Agent sessions</h1>
        <p>Follow model output and revisit every review pass.</p>
        {repository && <Link to={sessionPath()}>All repositories</Link>}
      </header>
      {list.error && <p role="alert">{list.error}</p>}
      {list.loading && <p role="status">Loading sessions…</p>}
      {list.data && !list.data.sessions.length && (
        <p>No sessions yet. Ask Uncle Bob, Linus, or Gandalf to begin.</p>
      )}
      {list.data?.sessions.map((session) => (
        <Link
          className="session-history-card"
          key={session.id}
          to={sessionPath(session.id, session.repository)}
        >
          <div>
            <strong>{agentNames[session.kind]}</strong>
            <AgentState status={session.status} />
          </div>
          <p>
            {session.repository} · {session.urls.length} {session.urls.length === 1 ? 'PR' : 'PRs'}{' '}
            · {session.runs.length} model {session.runs.length === 1 ? 'pass' : 'passes'}
          </p>
          <small>
            {session.progress} · <time>{new Date(session.createdAt).toLocaleString()}</time>
          </small>
        </Link>
      ))}
    </div>
  )
}

function selectPass(runs: AgentRun[], selected: string | null) {
  return (
    runs.find((run) => run.id === selected) ??
    runs.find((run) => run.status === 'running') ??
    runs.at(-1)
  )
}
