import { Provider } from '../../../shared/domain/types'
import { providerLabel } from '../../../shared/domain/preferences'
import { Link } from 'react-router'
import { OpenAI, ClaudeAI } from '~/components/Icons'
import { useAgentSession } from './useAgentSessions'
import { modelName, sessionPath } from './sessionPresentation'
import { AgentState } from './AgentState'
import './sessions.css'

export function AgentSessionCard({ sessionId }: { sessionId: string }) {
  const session = useAgentSession(sessionId, 1500).data
  if (!session) return null
  const run = session.runs.find((run) => run.status === 'running') ?? session.runs.at(-1)
  return (
    <Link className="agent-session-card" to={sessionPath(session.id, session.repository)}>
      {run ? (
        <span className="agent-model-line">
          {run.model.provider === Provider.codex ? (
            <OpenAI className="size-4" />
          ) : (
            <ClaudeAI className="size-4" />
          )}
          {providerLabel(run.model.provider)} {modelName(run.model)}
        </span>
      ) : (
        <span className="agent-model-line">
          {session.status === 'running' ? 'Preparing session…' : 'No model started'}
        </span>
      )}
      <AgentState status={session.status} />
    </Link>
  )
}
