import { randomUUID } from 'node:crypto'
import {
  CommandId,
  ThreadId,
  type OrchestrationV2Command,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadStreamItem,
  type OrchestrationV2TurnItem,
  type OrchestrationV2UserInputQuestion,
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
  readonly responses: readonly OrchestrationV2Command[]
  readonly outcome?: TurnOutcome
}

/** What a question the agent asks gets as its answer: nobody is there to answer it. */
export const UNATTENDED_ANSWER =
  'No one is available to answer. Decide with your best judgement and finish the task.'

type Message = Pick<OrchestrationV2ConversationMessage, 'role' | 'text'>
type Run = Pick<OrchestrationV2Run, 'id' | 'userMessageId' | 'status'>
type Request = Pick<OrchestrationV2RuntimeRequest, 'id' | 'kind' | 'status' | 'responseCapability'>
type Question = Pick<OrchestrationV2UserInputQuestion, 'id' | 'options' | 'allowCustomAnswer'>

/** Turn items that record a tool call; they appear in the transcript as tool events. */
const TOOL_ITEMS: ReadonlySet<OrchestrationV2TurnItem['type']> = new Set([
  'command_execution',
  'file_change',
  'file_search',
  'web_search',
  'dynamic_tool',
])

/**
 * Follows one turn of a thread from `orchestration.subscribeThread`. The turn is the run the
 * engine creates for the turn's user message, and it settles when that run does: `completed`
 * means completed, `failed` failed, and `interrupted`, `cancelled` or `rolled_back` interrupted.
 * Messages carry their whole text on every update, and events the snapshot already holds are
 * skipped.
 */
export class TurnFollower {
  private sequence = -1
  private started = false
  private running = false
  private runId: string | undefined
  private outcome: TurnOutcome | undefined
  private readonly messages = new Map<string, Message>()
  private readonly requests = new Map<string, Request>()
  private readonly questions = new Map<string, readonly Question[]>()
  /** The latest error the engine recorded on each run. */
  private readonly errors = new Map<string, string>()

  constructor(
    private readonly threadId: string,
    /** The id of the user message that starts this turn. */
    private readonly messageId: string,
    /** Runtime request ids already handled on this thread, shared across its turns. */
    private readonly answered: Set<string>,
    private readonly observer?: ProviderObserver,
  ) {}

  /** Whether the provider picked the turn up: it ran, or it already ended. */
  get began(): boolean {
    return this.running || this.outcome !== undefined
  }

  /** The engine run of this turn, once the engine created it. */
  get run(): string | undefined {
    return this.runId
  }

  receive(item: OrchestrationV2ThreadStreamItem): TurnStep {
    let start = false
    if (item.kind === 'snapshot') {
      start = !this.started
      this.started = true
      this.sequence = item.snapshotSequence
      this.restore(item.projection)
    } else if (item.kind === 'event' && item.sequence > this.sequence) {
      this.sequence = item.sequence
      const { event } = item
      if (event.type === 'message.updated') this.message(event.payload)
      if (event.type === 'run.created' || event.type === 'run.updated') this.settle(event.payload)
      if (event.type === 'runtime-request.updated') this.request(event.payload)
      if (event.type === 'turn-item.updated') this.item(event.payload)
    }
    const responses = this.started ? this.respond() : []
    return { start, responses, ...(this.outcome ? { outcome: this.outcome } : {}) }
  }

  private restore(projection: OrchestrationV2ThreadProjection) {
    this.messages.clear()
    for (const message of projection.messages) this.messages.set(message.id, message)
    for (const request of projection.runtimeRequests) this.request(request)
    for (const item of projection.turnItems) this.remember(item)
    for (const run of projection.runs) this.settle(run)
  }

  private message(message: OrchestrationV2ConversationMessage) {
    this.messages.set(message.id, message)
    if (message.role === 'assistant')
      this.observer?.({
        id: message.id,
        kind: 'assistant',
        text: message.text,
        status: message.streaming ? 'running' : 'complete',
      })
  }

  private settle(run: Run) {
    if (run.userMessageId !== this.messageId) return
    this.runId = run.id
    if (!this.started || this.outcome) return
    const { status } = run
    if (status === 'running' || status === 'waiting') this.running = true
    else if (status === 'completed') this.outcome = { status: 'completed', replies: this.replies() }
    else if (status === 'failed')
      this.outcome = { status: 'failed', error: this.errors.get(run.id) ?? 'The agent stopped.' }
    else if (status === 'interrupted' || status === 'cancelled' || status === 'rolled_back')
      this.outcome = { status: 'interrupted' }
  }

  private request(request: Request) {
    if (request.status === 'pending') this.requests.set(request.id, request)
    else {
      this.requests.delete(request.id)
      this.answered.add(request.id)
    }
  }

  private item(item: OrchestrationV2TurnItem) {
    this.remember(item)
    this.observe(item)
  }

  /** Keep what a later response or outcome needs: the questions asked, and the run's errors. */
  private remember(item: OrchestrationV2TurnItem) {
    if (item.type === 'user_input_request') this.questions.set(item.requestId, item.questions)
    if (item.type === 'error' && item.runId && item.status === 'failed')
      this.errors.set(item.runId, item.failure.message)
  }

  /** Decline the approvals and answer the questions that are still pending. */
  private respond(): OrchestrationV2Command[] {
    const responses: OrchestrationV2Command[] = []
    for (const request of this.requests.values()) {
      if (this.answered.has(request.id) || request.responseCapability.type === 'not_resumable')
        continue
      const base = {
        type: 'runtime-request.respond' as const,
        commandId: CommandId.make(randomUUID()),
        threadId: ThreadId.make(this.threadId),
        requestId: request.id,
      }
      if (request.kind === 'user_input') {
        // The questions arrive as a turn item, which may follow the request itself.
        const questions = this.questions.get(request.id)
        if (!questions) continue
        responses.push({
          ...base,
          answers: Object.fromEntries(questions.map((question) => unattended(question))),
        })
      } else responses.push({ ...base, decision: 'decline' })
      this.answered.add(request.id)
    }
    return responses
  }

  /** Reasoning, tool calls, declined approvals and errors appear in the transcript as they happen. */
  private observe(item: OrchestrationV2TurnItem) {
    if (!this.observer) return
    const event =
      item.type === 'reasoning'
        ? reasoningEvent(item)
        : TOOL_ITEMS.has(item.type)
          ? toolEvent(item)
          : item.type === 'approval_request' || item.type === 'error'
            ? noticeEvent(item)
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

function reasoningEvent(item: Extract<OrchestrationV2TurnItem, { type: 'reasoning' }>) {
  return {
    id: item.id,
    kind: 'reasoning',
    text: item.text,
    status: item.streaming ? 'running' : 'complete',
  } satisfies ProviderEvent
}

function toolEvent(item: OrchestrationV2TurnItem): ProviderEvent {
  const failed =
    item.status === 'failed' || item.status === 'cancelled' || item.status === 'interrupted'
  return {
    id: item.id,
    kind: 'tool',
    title: item.title ?? item.type.replaceAll('_', ' '),
    text: toolDetail(item),
    status: failed ? 'failed' : item.status === 'completed' ? 'complete' : 'running',
  }
}

/** What the tool call acted on: the command, the file, or the search. */
function toolDetail(item: OrchestrationV2TurnItem): string {
  if (item.type === 'command_execution') return item.input
  if (item.type === 'file_change') return item.fileName
  if (item.type === 'file_search') return item.pattern ?? ''
  if (item.type === 'web_search') return item.patterns?.join(', ') ?? ''
  return ''
}

function noticeEvent(
  item: Extract<OrchestrationV2TurnItem, { type: 'approval_request' | 'error' }>,
): ProviderEvent {
  if (item.type === 'error') {
    const title = item.title ?? 'Error'
    return {
      id: item.id,
      kind: 'activity',
      title,
      text: `${title}: ${item.failure.message}`,
      status: 'failed',
    }
  }
  const summary = item.title ?? `${item.requestKind} approval`
  return {
    id: item.id,
    kind: 'activity',
    title: 'Declined',
    text: item.prompt ? `${summary}: ${item.prompt}` : summary,
    status: 'complete',
  }
}

function unattended(question: Question) {
  const option = question.options[0]
  const answer =
    question.allowCustomAnswer === false && option
      ? (option.value ?? option.label)
      : UNATTENDED_ANSWER
  return [question.id, answer] as const
}
