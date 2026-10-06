import { Check, CirclePause, CircleX, LoaderCircle } from 'lucide-react'
import type { AgentSession } from '../../../shared/domain/agentSession'

export function AgentState({ status }: { status: AgentSession['status'] }) {
  const Icon =
    status === 'running'
      ? LoaderCircle
      : status === 'complete'
        ? Check
        : status === 'failed'
          ? CircleX
          : CirclePause
  return (
    <span className={`agent-state agent-state-${status}`}>
      <Icon
        size={13}
        className={status === 'running' ? 'animate-spin' : undefined}
        aria-hidden="true"
      />
      {status}
    </span>
  )
}
