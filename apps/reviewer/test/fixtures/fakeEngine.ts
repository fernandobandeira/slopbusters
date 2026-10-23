import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { ClientOrchestrationCommand, type OrchestrationThreadStreamItem } from '@t3tools/contracts'
import type { EngineClient } from '../../server/adapters/t3Engine/engineConnection'
import type { RunningEngine } from '../../server/adapters/t3Engine/engineLocation'
import { EngineTurns } from '../../server/adapters/t3Engine/engineTurns'

const engine: RunningEngine = {
  home: '/home/user/.t3',
  pid: 4242,
  origin: 'http://127.0.0.1:3773',
  environmentId: 'environment-1',
  serverVersion: '0.0.45',
}

type Command = Record<string, unknown> & { type: string }
type Item = OrchestrationThreadStreamItem

/**
 * A bundled engine that implements the RPCs structured turns use. Every dispatched command
 * is encoded with the contract's schema; `agent` plays the provider by emitting thread events.
 */
export function fakeEngine(
  agent: (command: Command, thread: FakeThread) => void,
  startTimeoutMs?: number,
) {
  const commands: Command[] = []
  const threads = new Map<string, FakeThread>()
  const thread = (id: unknown) => {
    const key = String(id)
    const existing = threads.get(key)
    if (existing) return existing
    const created = new FakeThread()
    threads.set(key, created)
    return created
  }
  const methods: Partial<Record<keyof EngineClient, unknown>> = {
    'orchestration.subscribeThread': (input: { threadId: string }) =>
      thread(input.threadId).subscribe(),
    'orchestration.dispatchCommand': (input: unknown) => {
      const command = Schema.encodeUnknownSync(ClientOrchestrationCommand)(input) as Command
      commands.push(command)
      agent(command, thread(command.threadId))
      return Effect.succeed({ sequence: commands.length })
    },
  }
  const connection = {
    run: <A, E>(
      operation: (client: EngineClient, engine: RunningEngine) => Effect.Effect<A, E>,
    ): Promise<A> => Effect.runPromise(Effect.orDie(operation(methods as EngineClient, engine))),
  }
  return {
    turns: new EngineTurns(connection, startTimeoutMs),
    commands,
    types: () => commands.map((command) => command.type),
    /** The directory the engine project of the run was created in. */
    workspaceRoots: () =>
      commands
        .filter((command) => command.type === 'project.create')
        .map((command) => String(command.workspaceRoot)),
  }
}

/** One thread's event log; each subscription starts with a snapshot of the messages so far. */
class FakeThread {
  sequence = 0
  private readonly messages: { id: string; role: string; text: string; streaming: boolean }[] = []
  private push: ((item: Item) => void) | undefined

  subscribe() {
    return Stream.callback<Item>((queue) =>
      Effect.sync(() => {
        this.push = (item) => {
          Queue.offerUnsafe(queue, item)
        }
        this.push({
          kind: 'snapshot',
          snapshot: {
            snapshotSequence: this.sequence,
            thread: { messages: [...this.messages], activities: [] },
          },
        } as unknown as Item)
      }),
    )
  }

  emit(type: string, payload: Record<string, unknown>) {
    this.sequence += 1
    if (type === 'thread.message-sent')
      this.messages.push({
        id: String(payload.messageId),
        role: String(payload.role),
        text: String(payload.text),
        streaming: false,
      })
    this.push?.({
      kind: 'event',
      event: { sequence: this.sequence, type, payload },
    } as unknown as Item)
  }

  session(status: string, extra: Record<string, unknown> = {}) {
    this.emit('thread.session-set', {
      session: { status, activeTurnId: status === 'running' ? 'turn-1' : null, ...extra },
    })
  }

  activity(kind: string, payload: Record<string, unknown>, tone = 'approval') {
    this.emit('thread.activity-appended', {
      activity: { id: `activity-${this.sequence}`, kind, tone, summary: kind, payload },
    })
  }

  /** The provider picks up the turn's message, replies with `text`, and settles. */
  reply(command: Command, text: string) {
    this.startTurn(command)
    this.assistant(text)
    this.session('ready')
  }

  startTurn(command: Command) {
    const message = command.message as { messageId: string; text: string }
    this.emit('thread.message-sent', {
      messageId: message.messageId,
      role: 'user',
      text: message.text,
      streaming: false,
    })
    this.session('starting')
    this.session('running')
  }

  assistant(text: string) {
    const messageId = `assistant-${this.sequence}`
    this.emit('thread.message-sent', { messageId, role: 'assistant', text, streaming: true })
    this.emit('thread.message-sent', { messageId, role: 'assistant', text: '', streaming: false })
  }
}
