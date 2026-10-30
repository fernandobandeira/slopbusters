import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import {
  OrchestrationV2Command,
  ProjectMutation,
  type OrchestrationV2ThreadStreamItem,
} from '@t3tools/contracts'
import {
  EngineDisconnectedError,
  type EngineClient,
} from '../../../../../server/adapters/t3Engine/engineConnection'
import type { RunningEngine } from '../../../../../server/adapters/t3Engine/engineLocation'
import { EngineTurns } from '../../../../../server/adapters/t3Engine/engineTurns'

const engine: RunningEngine = {
  home: '/home/user/.t3',
  pid: 4242,
  origin: 'http://127.0.0.1:3773',
  environmentId: 'environment-1',
  serverVersion: '0.1.0',
}

type Command = Record<string, unknown> & { type: string }
type Item = OrchestrationV2ThreadStreamItem

/**
 * A bundled engine that implements the RPCs structured turns use. Every dispatched command and
 * project mutation is encoded with the contract's schema; `agent` plays the provider by emitting
 * thread events.
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
      const command = Schema.encodeUnknownSync(OrchestrationV2Command)(input) as Command
      commands.push(command)
      agent(command, thread(command.threadId))
      return Effect.succeed({ sequence: commands.length })
    },
    'projects.mutate': (input: unknown) => {
      commands.push(Schema.encodeUnknownSync(ProjectMutation)(input))
      return Effect.succeed({})
    },
  }
  const connection = {
    run: <A, E>(
      operation: (client: EngineClient, engine: RunningEngine) => Effect.Effect<A, E>,
    ): Promise<A> =>
      Effect.runPromiseExit(operation(methods as EngineClient, engine)).then((exit) => {
        if (Exit.isSuccess(exit)) return exit.value
        throw Cause.squash(exit.cause)
      }),
  }
  return {
    turns: new EngineTurns(connection, startTimeoutMs),
    commands,
    thread,
    types: () => commands.map((command) => command.type),
    /** The directory the engine project of the run was created in. */
    workspaceRoots: () =>
      commands
        .filter((command) => command.type === 'project.create')
        .map((command) => String(command.workspaceRoot)),
  }
}

interface FakeMessage {
  id: string
  role: string
  text: string
  streaming: boolean
}

/**
 * One thread's event log; each subscription starts with a snapshot of the messages and runs so
 * far. Each turn the thread accepts becomes a run, which the provider moves along.
 */
class FakeThread {
  sequence = 0
  private readonly messages: FakeMessage[] = []
  private readonly runs: { id: string; userMessageId: string; status: string }[] = []
  private push: ((item: Item) => void) | undefined
  private fail: (() => void) | undefined
  /** Every later subscription fails at once, as when the engine socket keeps dropping. */
  unreachable = false
  subscriptions = 0

  subscribe() {
    this.subscriptions += 1
    return Stream.callback<Item, EngineDisconnectedError>((queue) =>
      Effect.sync(() => {
        const dropped = () => {
          Queue.failCauseUnsafe(queue, Cause.fail(new EngineDisconnectedError('ping timeout')))
        }
        if (this.unreachable) {
          dropped()
          return
        }
        this.fail = dropped
        this.push = (item) => {
          Queue.offerUnsafe(queue, item)
        }
        this.push({
          kind: 'snapshot',
          snapshotSequence: this.sequence,
          projection: {
            messages: [...this.messages],
            runs: this.runs.map((run) => ({ ...run })),
            runtimeRequests: [],
            turnItems: [],
          },
        } as unknown as Item)
      }),
    )
  }

  /** The socket drops: the subscription fails, and later events reach no one until resubscribed. */
  drop() {
    this.push = undefined
    this.fail?.()
    this.fail = undefined
  }

  emit(type: string, payload: Record<string, unknown>) {
    this.sequence += 1
    this.push?.({
      kind: 'event',
      sequence: this.sequence,
      event: { type, payload },
    } as unknown as Item)
  }

  /** The engine records the message and makes a run for it, which waits for the provider. */
  accept(command: Command) {
    const messageId = String(command.messageId)
    this.message({ id: messageId, role: 'user', text: String(command.text), streaming: false })
    const run = { id: `run-${String(this.runs.length + 1)}`, userMessageId: messageId, status: '' }
    this.runs.push(run)
    this.run('starting', 'run.created')
  }

  /** The provider picks up the turn's message, replies with `text`, and settles. */
  reply(command: Command, text: string) {
    this.startTurn(command)
    this.assistant(text)
    this.run('completed')
  }

  startTurn(command: Command) {
    this.accept(command)
    this.run('running')
  }

  /** Moves the latest run to `status`. */
  run(status: string, type = 'run.updated') {
    const run = this.runs.at(-1)
    if (!run) throw new Error('No run to update.')
    run.status = status
    this.emit(type, { ...run })
  }

  assistant(text: string) {
    const id = `assistant-${String(this.sequence)}`
    this.message({ id, role: 'assistant', text: text.slice(0, 1), streaming: true })
    this.message({ id, role: 'assistant', text, streaming: false })
  }

  message(message: FakeMessage) {
    const index = this.messages.findIndex((existing) => existing.id === message.id)
    if (index === -1) this.messages.push(message)
    else this.messages[index] = message
    this.emit('message.updated', { ...message, runId: this.runs.at(-1)?.id ?? null })
  }

  /** The agent asks for something; `kind` is `user_input` for questions. */
  request(id: string, kind: string) {
    this.emit('runtime-request.updated', {
      id,
      kind,
      status: 'pending',
      responseCapability: { type: 'live', providerSessionId: 'session-1' },
    })
  }

  item(type: string, fields: Record<string, unknown>) {
    this.emit('turn-item.updated', {
      id: `item-${String(this.sequence)}`,
      runId: this.runs.at(-1)?.id ?? null,
      status: 'completed',
      title: null,
      type,
      ...fields,
    })
  }
}
