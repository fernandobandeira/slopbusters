import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from '@t3tools/contracts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import * as Effect from 'effect/Effect'
import * as Queue from 'effect/Queue'
import * as Schema from 'effect/Schema'
import * as Stream from 'effect/Stream'
import { afterAll, expect, it } from 'vitest'
import { z } from 'zod'
import { ClientOrchestrationCommand, type OrchestrationThreadStreamItem } from '@t3tools/contracts'
import type { ProviderEvent } from '../shared/domain/agentSession'
import { Provider } from '../shared/domain/types'
import { CommandTimeoutError } from '../server/adapters/process'
import type { EngineClient } from '../server/adapters/t3Engine/engineConnection'
import type { RunningEngine } from '../server/adapters/t3Engine/engineLocation'
import { EngineTurns, type StructuredTurnRequest } from '../server/adapters/t3Engine/engineTurns'
import { UNATTENDED_ANSWER } from '../server/adapters/t3Engine/turnFollower'

const engine: RunningEngine = {
  home: '/home/user/.t3',
  pid: 4242,
  origin: 'http://127.0.0.1:3773',
  environmentId: 'environment-1',
  serverVersion: '0.0.45',
}
const claude = { provider: Provider.claude, model: 'claude-haiku-5-5' }
const filesSchema = z.object({ files: z.array(z.string()) })

/** A review checkout that carries agent configuration a repository could use to run code. */
const checkout = mkdtempSync(join(tmpdir(), 'turns-checkout-'))
mkdirSync(join(checkout, 'src'))
mkdirSync(join(checkout, '.claude'))
mkdirSync(join(checkout, '.git'))
writeFileSync(join(checkout, 'README.md'), 'readme\n')
writeFileSync(join(checkout, 'CLAUDE.md'), 'instructions\n')
writeFileSync(join(checkout, 'src', 'index.ts'), 'export {}\n')
writeFileSync(join(checkout, '.claude', 'settings.json'), '{"hooks":{}}\n')
writeFileSync(join(checkout, '.git', 'config'), '[core]\n\tfsmonitor = touch /tmp/x\n')
writeFileSync(join(checkout, '.mcp.json'), '{}\n')
afterAll(() => {
  rmSync(checkout, { recursive: true, force: true })
})

type Command = Record<string, unknown> & { type: string }
type Item = OrchestrationThreadStreamItem

/**
 * A bundled engine that implements the RPCs structured turns use. Every dispatched command
 * is encoded with the contract's schema; `agent` plays the provider by emitting thread events.
 */
function fakeEngine(agent: (command: Command, thread: FakeThread) => void) {
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
    turns: new EngineTurns(connection),
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

function request(
  overrides: Partial<StructuredTurnRequest<z.infer<typeof filesSchema>>> = {},
): StructuredTurnRequest<z.infer<typeof filesSchema>> {
  return {
    model: claude,
    prompt: 'List the top-level files.',
    schema: filesSchema,
    signal: new AbortController().signal,
    directory: checkout,
    purpose: 'files',
    ...overrides,
  }
}

const fenced = (value: unknown) => `Here you go:\n\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``

const lifecycle = (...turns: string[]) => [
  'project.create',
  'thread.create',
  ...turns,
  'thread.session.stop',
  'thread.archive',
  'project.delete',
]

it('runs one read-only turn in a per-run project and returns the validated JSON', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') thread.reply(command, fenced({ files: ['a.ts'] }))
  })
  const events: ProviderEvent[] = []

  const result = await fake.turns.run(request({ observer: (event) => events.push(event) }))

  expect(result).toEqual({ files: ['a.ts'] })
  expect(fake.types()).toEqual(lifecycle('thread.turn.start'))
  const [project, create, start] = fake.commands
  expect(create).toMatchObject({
    projectId: project?.projectId,
    title: 'Slopbusters · files',
    modelSelection: { instanceId: 'claudeAgent', model: 'claude-haiku-5-5' },
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    branch: null,
    worktreePath: null,
  })
  expect(start).toMatchObject({ runtimeMode: 'approval-required', interactionMode: 'default' })
  const text = (start?.message as { text: string }).text
  expect(text).toMatch(/^List the top-level files\.\n/)
  expect(text).toContain('"files"')
  expect(text).toContain('Do not create, edit or delete files')
  expect(fake.commands.at(-1)).toMatchObject({ projectId: project?.projectId, force: true })
  expect(events[0]).toMatchObject({ kind: 'prompt', text: 'List the top-level files.' })
  expect(events.at(-1)).toMatchObject({ kind: 'assistant', status: 'complete' })
})

it('starts Codex in the workspace-write sandbox of its throwaway copy', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(request({ model: { provider: Provider.codex, model: 'gpt-6.1-sol' } }))

  const create = fake.commands.find((command) => command.type === 'thread.create')
  const start = fake.commands.find((command) => command.type === 'thread.turn.start')
  expect(create).toMatchObject({
    modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
    runtimeMode: 'auto-accept-edits',
  })
  expect(start).toMatchObject({ runtimeMode: 'auto-accept-edits' })
})

it('runs the agent in a scrubbed copy of the directory that it deletes afterwards', async () => {
  let copied: string[] = []
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'thread.turn.start') return
    const root = fake.workspaceRoots()[0] ?? ''
    copied = ['README.md', 'CLAUDE.md', 'src/index.ts', '.claude', '.git', '.mcp.json'].filter(
      (path) => existsSync(join(root, path)),
    )
    writeFileSync(join(root, 'README.md'), 'changed by the agent\n')
    thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(request())

  const [root] = fake.workspaceRoots()
  expect(root).not.toBe(checkout)
  expect(basename(root ?? '')).toBe(basename(checkout))
  expect(copied).toEqual(['README.md', 'CLAUDE.md', 'src/index.ts'])
  expect(existsSync(root ?? '')).toBe(false)
  expect(readFileSync(join(checkout, 'README.md'), 'utf8')).toBe('readme\n')
  expect(existsSync(join(checkout, '.claude', 'settings.json'))).toBe(true)
})

it('moves a prompt longer than the engine accepts into a file the agent reads from its copy', async () => {
  const prompt = `Find the marker.\n${'x'.repeat(130_000)}MARKER`
  let instructions = ''
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'thread.turn.start') return
    const root = fake.workspaceRoots()[0] ?? ''
    instructions = readFileSync(join(root, '.slopbusters', 'instructions.md'), 'utf8')
    thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(request({ prompt }))

  const start = fake.commands.find((command) => command.type === 'thread.turn.start')
  const text = (start?.message as { text: string }).text
  expect(text.length).toBeLessThan(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)
  expect(text).toContain('in the file .slopbusters/instructions.md')
  expect(text).toContain('Read it with the Read tool, 150 lines at a time')
  expect(text).toContain('"files"')
  expect(instructions.split('\n').every((line) => line.length <= 500)).toBe(true)
  expect(instructions.replaceAll('\n', '')).toBe(prompt.replaceAll('\n', ''))
})

it('gives overlapping runs on one directory their own copies and projects', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') thread.reply(command, '{"files":[]}')
  })

  await Promise.all([fake.turns.run(request()), fake.turns.run(request())])

  expect(new Set(fake.workspaceRoots()).size).toBe(2)
  const deleted = fake.commands.filter((command) => command.type === 'project.delete')
  expect(deleted).toHaveLength(2)
})

it('declines every approval and answers questions so the turn never waits on a person', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') {
      thread.startTurn(command)
      thread.activity('approval.requested', { requestId: 'write-1', requestKind: 'file-change' })
      thread.activity('user-input.requested', {
        requestId: 'question-1',
        questions: [
          { id: 'scope', header: 'Scope', question: 'Which files?', options: [] },
          {
            id: 'pick',
            header: 'Pick',
            question: 'Pick one',
            options: [{ label: 'First', description: '' }],
            allowCustomAnswer: false,
          },
        ],
      })
    }
    if (command.type === 'thread.user-input.respond') {
      thread.assistant('{"files":["README.md"]}')
      thread.session('ready')
    }
  })

  await expect(fake.turns.run(request())).resolves.toEqual({ files: ['README.md'] })

  const approval = fake.commands.find((command) => command.type === 'thread.approval.respond')
  expect(approval).toMatchObject({ requestId: 'write-1', decision: 'decline' })
  const answer = fake.commands.find((command) => command.type === 'thread.user-input.respond')
  expect(answer).toMatchObject({
    requestId: 'question-1',
    answers: { scope: UNATTENDED_ANSWER, pick: 'First' },
  })
})

it('quotes the validation error in one corrective turn and returns the corrected reply', async () => {
  let turns = 0
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'thread.turn.start') return
    turns += 1
    thread.reply(command, turns === 1 ? fenced({ files: 'a.ts' }) : fenced({ files: ['a.ts'] }))
  })

  await expect(fake.turns.run(request())).resolves.toEqual({ files: ['a.ts'] })

  const starts = fake.commands.filter((command) => command.type === 'thread.turn.start')
  expect(starts).toHaveLength(2)
  const correction = (starts[1]?.message as { text: string }).text
  expect(correction).toContain('did not match the output contract')
  expect(correction).toContain('files')
})

it('fails after the corrective turn also misses the schema, and still archives', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') thread.reply(command, 'I could not find any files.')
  })

  await expect(fake.turns.run(request())).rejects.toThrow(
    'Claude did not reply with the requested JSON: The reply did not contain valid JSON.',
  )

  expect(fake.types()).toEqual(lifecycle('thread.turn.start', 'thread.turn.start'))
})

it('reports a turn the provider fails', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'thread.turn.start') return
    thread.startTurn(command)
    thread.session('error', { lastError: 'Model not available.' })
  })

  await expect(fake.turns.run(request())).rejects.toThrow('Claude failed: Model not available.')
  expect(fake.types().slice(-3)).toEqual(lifecycle().slice(-3))
})

it('interrupts the turn when the caller cancels', async () => {
  const controller = new AbortController()
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') {
      thread.startTurn(command)
      setTimeout(() => {
        controller.abort()
      }, 0)
    }
  })

  await expect(fake.turns.run(request({ signal: controller.signal }))).rejects.toThrow(
    'The operation was cancelled.',
  )

  expect(fake.types()).toEqual(lifecycle('thread.turn.start', 'thread.turn.interrupt'))
})

it('interrupts the turn and reports a timeout when the agent runs too long', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') thread.startTurn(command)
  })

  const run = fake.turns.run(request({ timeoutMs: 20 }))

  await expect(run).rejects.toBeInstanceOf(CommandTimeoutError)
  expect(fake.types()).toContain('thread.turn.interrupt')
  expect(fake.types().slice(-3)).toEqual(lifecycle().slice(-3))
})

it('runs without a directory in a scratch project that it deletes afterwards', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'thread.turn.start') thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(request({ directory: undefined }))

  const created = fake.commands.find((command) => command.type === 'project.create')
  const scratch = String(created?.workspaceRoot)
  expect(scratch).toMatch(/slopbusters-turn-/)
  expect(fake.commands.at(-1)).toMatchObject({
    type: 'project.delete',
    projectId: created?.projectId,
    force: true,
  })
  expect(existsSync(scratch)).toBe(false)
})

it('ignores replayed events the snapshot already holds', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'thread.turn.start') return
    thread.startTurn(command)
    thread.emit('thread.message-sent', {
      messageId: 'reply',
      role: 'assistant',
      text: '{"files":["a"]}',
      streaming: true,
    })
    // A live event the server buffered while reading the snapshot arrives again.
    const replayed = thread.sequence
    thread.sequence -= 1
    thread.emit('thread.message-sent', {
      messageId: 'reply',
      role: 'assistant',
      text: '{"files":["a"]}',
      streaming: true,
    })
    thread.sequence = replayed
    thread.session('ready')
  })

  await expect(fake.turns.run(request())).resolves.toEqual({ files: ['a'] })
})

it('copies included folders, such as a skill, into the copy, scrubbed, and never outside it', async () => {
  const skill = mkdtempSync(join(tmpdir(), 'turns-skill-'))
  mkdirSync(join(skill, '.claude'))
  writeFileSync(join(skill, 'patterns.md'), 'patterns\n')
  const paths = ['README.md', 'skill/patterns.md', 'skill/.claude']
  let copied: string[] = []
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'thread.turn.start') return
    copied = paths.filter((path) => existsSync(join(fake.workspaceRoots()[0] ?? '', path)))
    thread.reply(command, '{"files":[]}')
  })
  await fake.turns.run(request({ include: [{ directory: skill, as: 'skill' }] }))
  const escape = fake.turns.run(request({ include: [{ directory: skill, as: '../escape' }] }))

  await expect(escape).rejects.toThrow(/must stay inside the working directory/)
  expect(copied).toEqual(['README.md', 'skill/patterns.md'])
  rmSync(skill, { recursive: true, force: true })
})
