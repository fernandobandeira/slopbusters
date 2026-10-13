import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  ApprovalRequestId,
  CommandId,
  ThreadId,
  type ClientOrchestrationCommand,
  type OrchestrationMessage,
  type OrchestrationSession,
  type OrchestrationThreadActivity,
  type OrchestrationThreadStreamItem,
} from '@t3tools/contracts'
import type { ProviderEvent, ProviderObserver } from '../../../shared/domain/agentSession'

/** How one turn ended. `replies` are the assistant messages after the turn's prompt, in order. */
export type TurnOutcome =
  | { readonly status: 'completed'; readonly replies: readonly string[] }
  | { readonly status: 'failed'; readonly error: string }
  | { readonly status: 'interrupted' }

export interface TurnStep {
  /** True once, on the first snapshot: the caller sends the turn's prompt then. */
  readonly start: boolean
  /** Commands that keep the turn moving without a human: declined approvals, answered questions. */
  readonly responses: readonly ClientOrchestrationCommand[]
  readonly outcome?: TurnOutcome
}

/** What a question the agent asks gets as its answer: nobody is there to answer it. */
export const UNATTENDED_ANSWER =
  'No one is available to answer. Decide with your best judgement and finish the task.'

const requestSchema = z.object({ requestId: z.string().min(1) })
const questionsSchema = z.object({
  requestId: z.string().min(1),
  questions: z.array(
    z.object({
      id: z.string(),
      options: z.array(z.object({ label: z.string(), value: z.string().optional() })),
      allowCustomAnswer: z.boolean().optional(),
    }),
  ),
})
const toolSchema = z.object({
  toolCallId: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  status: z.string().optional(),
})
const detailSchema = z.object({ detail: z.string().optional(), message: z.string().optional() })

type Message = Pick<OrchestrationMessage, 'role' | 'text' | 'streaming'>

/**
 * Follows one turn of a thread from `orchestration.subscribeThread`. The engine settles a turn
 * when the thread's session leaves `running` (see T3 Code's projector): `ready` or `idle` means
 * completed, `error` failed, `interrupted` or `stopped` interrupted. Messages are merged the way
 * the engine's projector merges them, and events the snapshot already holds are skipped.
 */
export class TurnFollower {
  private sequence = -1
  private started = false
  private running = false
  private outcome: TurnOutcome | undefined
  private readonly messages = new Map<string, Message>()

  constructor(
    private readonly threadId: string,
    /** The id of the user message that starts this turn. */
    private readonly messageId: string,
    /** Approval and question ids already handled on this thread, shared across its turns. */
    private readonly answered: Set<string>,
    private readonly observer?: ProviderObserver,
  ) {}

  receive(item: OrchestrationThreadStreamItem): TurnStep {
    const responses: ClientOrchestrationCommand[] = []
    let start = false
    if (item.kind === 'snapshot') {
      start = !this.started
      this.started = true
      this.sequence = item.snapshot.snapshotSequence
      this.messages.clear()
      for (const message of item.snapshot.thread.messages) this.messages.set(message.id, message)
      const activities = item.snapshot.thread.activities
      for (const activity of activities) if (isResolution(activity)) this.resolve(activity)
      for (const activity of activities) responses.push(...this.respond(activity))
    } else if (item.kind === 'event' && item.event.sequence > this.sequence) {
      this.sequence = item.event.sequence
      const { event } = item
      if (event.type === 'thread.message-sent') this.message(event.payload)
      if (event.type === 'thread.session-set') this.session(event.payload.session)
      if (event.type === 'thread.activity-appended') responses.push(...this.activity(event.payload))
    }
    return { start, responses, ...(this.outcome ? { outcome: this.outcome } : {}) }
  }

  private message(payload: {
    messageId: string
    role: Message['role']
    text: string
    streaming: boolean
  }) {
    const existing = this.messages.get(payload.messageId)
    const text = !existing
      ? payload.text
      : payload.streaming
        ? existing.text + payload.text
        : payload.text || existing.text
    const message = { role: payload.role, text, streaming: payload.streaming }
    this.messages.set(payload.messageId, message)
    if (message.role === 'assistant' || message.role === 'reasoning')
      this.observer?.({
        id: payload.messageId,
        kind: message.role,
        text: message.text,
        status: message.streaming ? 'running' : 'complete',
      })
  }

  private session(session: OrchestrationSession) {
    if (!this.started || this.outcome) return
    const { status } = session
    if (status === 'running') {
      this.running ||= session.activeTurnId !== null
      return
    }
    if (status === 'error')
      this.outcome = { status: 'failed', error: session.lastError ?? 'The agent stopped.' }
    else if (!this.running || status === 'starting') return
    else if (status === 'ready' || status === 'idle')
      this.outcome = { status: 'completed', replies: this.replies() }
    else this.outcome = { status: 'interrupted' }
  }

  private activity({ activity }: { activity: OrchestrationThreadActivity }) {
    if (isResolution(activity)) this.resolve(activity)
    this.observe(activity)
    if (activity.kind === 'provider.turn.start.failed' && !this.outcome) {
      const failed = requestSchema.extend(detailSchema.shape).safeParse(activity.payload).data
      if (failed?.requestId === this.messageId)
        this.outcome = { status: 'failed', error: failed.detail ?? activity.summary }
    }
    return this.respond(activity)
  }

  /** Decline the approvals and answer the questions that are still pending. */
  private respond(activity: OrchestrationThreadActivity): ClientOrchestrationCommand[] {
    const base = () => ({
      commandId: CommandId.make(randomUUID()),
      threadId: ThreadId.make(this.threadId),
      createdAt: new Date().toISOString(),
    })
    if (activity.kind === 'approval.requested') {
      const request = requestSchema.safeParse(activity.payload).data
      if (!request || this.answered.has(request.requestId)) return []
      this.answered.add(request.requestId)
      return [
        {
          ...base(),
          type: 'thread.approval.respond',
          requestId: ApprovalRequestId.make(request.requestId),
          decision: 'decline',
        },
      ]
    }
    if (activity.kind === 'user-input.requested') {
      const request = questionsSchema.safeParse(activity.payload).data
      if (!request || this.answered.has(request.requestId)) return []
      this.answered.add(request.requestId)
      return [
        {
          ...base(),
          type: 'thread.user-input.respond',
          requestId: ApprovalRequestId.make(request.requestId),
          answers: Object.fromEntries(request.questions.map((question) => unattended(question))),
        },
      ]
    }
    return []
  }

  private resolve(activity: OrchestrationThreadActivity) {
    const request = requestSchema.safeParse(activity.payload).data
    if (request) this.answered.add(request.requestId)
  }

  /** Tool calls, declined approvals and errors appear in the transcript as they happen. */
  private observe(activity: OrchestrationThreadActivity) {
    if (!this.observer) return
    const event =
      activity.tone === 'tool'
        ? toolEvent(activity)
        : activity.kind === 'approval.requested' || activity.tone === 'error'
          ? noticeEvent(activity)
          : undefined
    if (event) this.observer(event)
  }

  /** The assistant messages that follow this turn's prompt. */
  private replies(): string[] {
    const messages = [...this.messages.entries()]
    const prompt = messages.findIndex(([id]) => id === this.messageId)
    if (prompt === -1) return []
    return messages
      .slice(prompt + 1)
      .filter(([, message]) => message.role === 'assistant' && message.text.trim())
      .map(([, message]) => message.text)
  }
}

function toolEvent(activity: OrchestrationThreadActivity): ProviderEvent {
  const tool = toolSchema.safeParse(activity.payload).data ?? {}
  const failed = tool.status === 'failed' || tool.status === 'declined'
  return {
    id: tool.toolCallId ?? activity.id,
    kind: 'tool',
    title: tool.title ?? activity.summary,
    text: tool.detail ?? '',
    status: failed ? 'failed' : activity.kind === 'tool.completed' ? 'complete' : 'running',
  }
}

function noticeEvent(activity: OrchestrationThreadActivity): ProviderEvent {
  const detail = detailSchema.safeParse(activity.payload).data
  const text = detail?.detail ?? detail?.message
  return {
    id: activity.id,
    kind: 'activity',
    title: activity.kind === 'approval.requested' ? 'Declined' : activity.summary,
    text: text ? `${activity.summary}: ${text}` : activity.summary,
    status: activity.tone === 'error' ? 'failed' : 'complete',
  }
}

function isResolution(activity: OrchestrationThreadActivity) {
  return activity.kind === 'approval.resolved' || activity.kind === 'user-input.resolved'
}

function unattended(question: z.infer<typeof questionsSchema>['questions'][number]) {
  const option = question.options[0]
  const answer =
    question.allowCustomAnswer === false && option
      ? (option.value ?? option.label)
      : UNATTENDED_ANSWER
  return [question.id, answer] as const
}
