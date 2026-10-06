import { Provider } from '../../../shared/domain/types'
import { Link } from 'react-router'
import { OpenAI, ClaudeAI } from '~/components/ProviderLogos'
import { useAgentSessions } from './useAgentSessions'
import { agentNames, modelName, sessionPath } from './sessionPresentation'
import { AgentState } from './AgentState'
import './sessions.css'

export function AgentActivity({ repository }: { repository?: string }) {
  const query = useAgentSessions()
  const sessions = query.data?.sessions ?? []
  const visible = sessions
    .filter((session) => session.status === 'running')
    .concat(
      sessions
        .filter(
          (session) =>
            session.status !== 'running' && (!repository || session.repository === repository),
        )
        .slice(0, 2),
    )
  if (!visible.length) return null
  return (
    <aside className="agent-activity" aria-label="Agent activity">
      {visible.map((session) => {
        const active = session.runs.filter((run) => run.status === 'running')
        const models = active.length ? active : session.runs.slice(-1)
        return (
          <Link
            key={session.id}
            className="agent-activity-card"
            to={sessionPath(session.id, session.repository)}
          >
            <div>
              <strong>{agentNames[session.kind]}</strong>
              <AgentState status={session.status} />
            </div>
            {models.length ? (
              models.map((run) => (
                <span className="agent-model-line" key={run.id}>
                  {run.model.provider === Provider.codex ? (
                    <OpenAI className="size-4" />
                  ) : (
                    <ClaudeAI className="size-4" />
                  )}
                  {run.model.provider === Provider.codex ? 'Codex' : 'Claude'}{' '}
                  {modelName(run.model)}
                </span>
              ))
            ) : (
              <span>Preparing session…</span>
            )}
            <small>
              {session.repository !== repository && `${session.repository} · `}
              {session.progress}
            </small>
          </Link>
        )
      })}
    </aside>
  )
}
