import { Provider } from '../../../shared/domain/types'
import { Link } from 'react-router'
import { OpenAI, ClaudeAI } from '~/components/ProviderLogos'
import { useAgentSessions } from './useAgentSessions'
import { agentNames, modelName, sessionPath } from './sessionPresentation'
import { AgentState } from './AgentState'
import './sessions.css'

export function AgentSessionCard({
  sessionId,
  repository,
}: {
  sessionId: string
  repository: string
}) {
  const query = useAgentSessions(repository)
  const session = query.data?.sessions.find((session) => session.id === sessionId)
  if (!session) return null
  const active = session.runs.filter((run) => run.status === 'running')
  const models = active.length ? active : session.runs.slice(-1)
  return (
    <Link className="agent-session-card" to={sessionPath(session.id, session.repository)}>
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
            {run.model.provider === Provider.codex ? 'Codex' : 'Claude'} {modelName(run.model)}
          </span>
        ))
      ) : (
        <span>Preparing session…</span>
      )}
      <small>{session.progress}</small>
    </Link>
  )
}
