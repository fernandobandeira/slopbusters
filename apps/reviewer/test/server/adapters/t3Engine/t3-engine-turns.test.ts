import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from '@t3tools/contracts'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, expect, it } from 'vitest'
import { z } from 'zod'
import type { ProviderEvent } from '../../../../shared/domain/agentSession'
import { Provider } from '../../../../shared/domain/types'
import { CommandTimeoutError } from '../../../../server/adapters/process'
import type { StructuredTurnRequest } from '../../../../server/adapters/t3Engine/engineTurns'
import { UNATTENDED_ANSWER } from '../../../../server/adapters/t3Engine/turnFollower'
import { MAX_STRUCTURED_FOLLOW_UPS } from '../../../../server/adapters/t3Engine/limits'
import { fakeEngine } from './fixtures/fakeEngine'

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
  'thread.archive',
  'project.delete',
]

it('runs one read-only turn in a per-run project and returns the validated JSON', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.reply(command, fenced({ files: ['a.ts'] }))
  })
  const events: ProviderEvent[] = []

  const result = await fake.turns.run(request({ observer: (event) => events.push(event) }))

  expect(result).toEqual({ files: ['a.ts'] })
  expect(fake.types()).toEqual(lifecycle('message.dispatch'))
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
  expect(start).toMatchObject({
    createdBy: 'user',
    modelSelection: { instanceId: 'claudeAgent', model: 'claude-haiku-5-5' },
    dispatchMode: { type: 'start_immediately' },
    attachments: [],
  })
  const text = String(start?.text)
  expect(text).toMatch(/^List the top-level files\.\n/)
  expect(text).toContain('"files"')
  expect(text).toContain('Do not create, edit or delete files')
  expect(fake.commands.at(-1)).toMatchObject({ projectId: project?.projectId, force: true })
  expect(events[0]).toMatchObject({ kind: 'prompt', text: 'List the top-level files.' })
  expect(events.at(-1)).toMatchObject({ kind: 'assistant', status: 'complete' })
})

it('starts Codex in the workspace-write sandbox of its throwaway copy', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(request({ model: { provider: Provider.codex, model: 'gpt-6.1-sol' } }))

  const create = fake.commands.find((command) => command.type === 'thread.create')
  expect(create).toMatchObject({
    modelSelection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
    runtimeMode: 'auto-accept-edits',
  })
})

it('runs the agent in a scrubbed copy of the directory that it deletes afterwards', async () => {
  let copied: string[] = []
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
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
    if (command.type !== 'message.dispatch') return
    const root = fake.workspaceRoots()[0] ?? ''
    instructions = readFileSync(join(root, '.slopbusters', 'instructions.md'), 'utf8')
    thread.reply(command, '{"files":[]}')
  })

  await fake.turns.run(request({ prompt }))

  const start = fake.commands.find((command) => command.type === 'message.dispatch')
  const text = String(start?.text)
  expect(text.length).toBeLessThan(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)
  expect(text).toContain('in the file .slopbusters/instructions.md')
  expect(text).toContain('Read it with the Read tool, 150 lines at a time')
  expect(text).toContain('"files"')
  expect(instructions.split('\n').every((line) => line.length <= 500)).toBe(true)
  expect(instructions.replaceAll('\n', '')).toBe(prompt.replaceAll('\n', ''))
})

it('gives overlapping runs on one directory their own copies and projects', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.reply(command, '{"files":[]}')
  })

  await Promise.all([fake.turns.run(request()), fake.turns.run(request())])

  expect(new Set(fake.workspaceRoots()).size).toBe(2)
  const deleted = fake.commands.filter((command) => command.type === 'project.delete')
  expect(deleted).toHaveLength(2)
})

it('declines every approval and answers questions so the turn never waits on a person', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') {
      thread.startTurn(command)
      thread.request('write-1', 'file-change')
      thread.item('approval_request', { requestId: 'write-1', requestKind: 'file-change' })
      // The question's request arrives before the turn item that holds the questions.
      thread.request('question-1', 'user_input')
      thread.item('user_input_request', {
        requestId: 'question-1',
        questions: [
          { id: 'scope', header: 'Scope', question: 'Which files?', options: [] },
          {
            id: 'pick',
            header: 'Pick',
            question: 'Pick one',
            options: [{ label: 'First', description: 'The first one' }],
            allowCustomAnswer: false,
          },
        ],
      })
    }
    if (command.type === 'runtime-request.respond' && command.answers) {
      thread.assistant('{"files":["README.md"]}')
      thread.run('completed')
    }
  })
  const events: ProviderEvent[] = []

  await expect(
    fake.turns.run(request({ observer: (event) => events.push(event) })),
  ).resolves.toEqual({ files: ['README.md'] })

  const responses = fake.commands.filter((command) => command.type === 'runtime-request.respond')
  expect(responses).toHaveLength(2)
  expect(responses[0]).toMatchObject({ requestId: 'write-1', decision: 'decline' })
  expect(events).toContainEqual(expect.objectContaining({ kind: 'activity', title: 'Declined' }))
  expect(responses[1]).toMatchObject({
    requestId: 'question-1',
    answers: { scope: UNATTENDED_ANSWER, pick: 'First' },
  })
})

it('quotes the validation error in one corrective turn and returns the corrected reply', async () => {
  let turns = 0
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    turns += 1
    thread.reply(command, turns === 1 ? fenced({ files: 'a.ts' }) : fenced({ files: ['a.ts'] }))
  })

  await expect(fake.turns.run(request())).resolves.toEqual({ files: ['a.ts'] })

  const starts = fake.commands.filter((command) => command.type === 'message.dispatch')
  expect(starts).toHaveLength(2)
  const correction = String(starts[1]?.text)
  expect(correction).toContain('did not match the output contract')
  expect(correction).toContain('files')
})

it('fails after the corrective turn also misses the schema, and still archives', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.reply(command, 'I could not find any files.')
  })

  await expect(fake.turns.run(request())).rejects.toThrow(
    'Claude did not reply with the requested JSON: The reply did not contain valid JSON.',
  )

  expect(fake.types()).toEqual(lifecycle('message.dispatch', 'message.dispatch'))
})

it('reports a turn the provider fails', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    thread.startTurn(command)
    thread.item('error', {
      status: 'failed',
      failure: { class: 'provider_error', message: 'Model not available.' },
    })
    thread.run('failed')
  })

  await expect(fake.turns.run(request())).rejects.toThrow('Claude failed: Model not available.')
  expect(fake.types().slice(-2)).toEqual(lifecycle().slice(-2))
})

it('interrupts the turn when the caller cancels', async () => {
  const controller = new AbortController()
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') {
      thread.startTurn(command)
      setTimeout(() => {
        controller.abort()
      }, 0)
    }
  })

  await expect(fake.turns.run(request({ signal: controller.signal }))).rejects.toThrow(
    'The operation was cancelled.',
  )

  expect(fake.types()).toEqual(lifecycle('message.dispatch', 'run.interrupt'))
})

it('interrupts the turn and reports a timeout when the agent runs too long', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.startTurn(command)
  })

  const run = fake.turns.run(request({ timeoutMs: 20 }))

  await expect(run).rejects.toBeInstanceOf(CommandTimeoutError)
  expect(fake.types()).toContain('run.interrupt')
  expect(fake.types().slice(-2)).toEqual(lifecycle().slice(-2))
})

it('fails fast when the engine accepts a turn but never starts it', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.accept(command)
  }, 20)

  const run = fake.turns.run(request({ timeoutMs: 60_000 }))

  await expect(run).rejects.toThrow(/Claude never started this turn/)
  expect(fake.types()).toEqual(lifecycle('message.dispatch', 'run.interrupt'))
})

it('keeps waiting on a turn that started, past the start check', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    thread.startTurn(command)
    setTimeout(() => {
      thread.assistant(fenced({ files: ['README.md'] }))
      thread.run('completed')
    }, 60)
  }, 10)

  await expect(fake.turns.run(request())).resolves.toEqual({ files: ['README.md'] })
})

it('runs without a directory in a scratch project that it deletes afterwards', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.reply(command, '{"files":[]}')
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
    if (command.type !== 'message.dispatch') return
    thread.startTurn(command)
    thread.message({ id: 'reply', role: 'assistant', text: '{"files":["a"]}', streaming: false })
    // A live event the server buffered while reading the snapshot arrives again, stale.
    const replayed = thread.sequence
    thread.sequence -= 1
    thread.emit('message.updated', { id: 'reply', role: 'assistant', text: '', streaming: true })
    thread.sequence = replayed
    thread.run('completed')
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
    if (command.type !== 'message.dispatch') return
    copied = paths.filter((path) => existsSync(join(fake.workspaceRoots()[0] ?? '', path)))
    thread.reply(command, '{"files":[]}')
  })
  await fake.turns.run(request({ include: [{ directory: skill, as: 'skill' }] }))
  const escape = fake.turns.run(request({ include: [{ directory: skill, as: '../escape' }] }))

  await expect(escape).rejects.toThrow(/must stay inside the working directory/)
  expect(copied).toEqual(['README.md', 'skill/patterns.md'])
  rmSync(skill, { recursive: true, force: true })
})

it('lets the agent edit a copy that keeps Git metadata, and settles the copy before deleting it', async () => {
  let copied: string[] = []
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    const root = fake.workspaceRoots()[0] ?? ''
    copied = ['.git', '.claude', 'README.md'].filter((path) => existsSync(join(root, path)))
    writeFileSync(join(root, 'README.md'), 'edited by the agent\n')
    thread.reply(command, fenced({ files: ['README.md'] }))
  })
  const settled: string[] = []

  const result = await fake.turns.run(
    request({
      copy: {
        git: true,
        editable: true,
        settle: (copy, reply) => {
          settled.push(
            `${readFileSync(join(copy, 'README.md'), 'utf8').trim()}: ${reply.files.join()}`,
          )
          return Promise.resolve(undefined)
        },
      },
    }),
  )

  expect(result).toEqual({ files: ['README.md'] })
  expect(settled).toEqual(['edited by the agent: README.md'])
  expect(copied).toEqual(['.git', 'README.md'])
  const create = fake.commands.find((command) => command.type === 'thread.create')
  expect(create).toMatchObject({ runtimeMode: 'auto-accept-edits' })
  const start = fake.commands.find((command) => command.type === 'message.dispatch')
  expect(String(start?.text)).toContain('editing files there in place')
  expect(String(start?.text)).toContain('read-only Git commands')
  expect(readFileSync(join(checkout, 'README.md'), 'utf8')).toBe('readme\n')
  expect(existsSync(fake.workspaceRoots()[0] ?? '')).toBe(false)
})

it('sends problems found in the copy back in the same thread until they are fixed', async () => {
  let turns = 0
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    turns += 1
    thread.reply(command, fenced({ files: [String(turns)] }))
  })
  const settle = (_copy: string, reply: { files: string[] }) =>
    Promise.resolve(reply.files[0] === '1' ? 'code.ts still has conflict markers.' : undefined)

  const result = await fake.turns.run(request({ copy: { editable: true, settle } }))

  expect(result).toEqual({ files: ['2'] })
  expect(fake.types()).toEqual(lifecycle('message.dispatch', 'message.dispatch'))
  const followUp = String(
    fake.commands.filter((command) => command.type === 'message.dispatch')[1]?.text,
  )
  expect(followUp).toContain('code.ts still has conflict markers.')
  expect(followUp).toContain('reply again with only one JSON object')
})

it('stops following up after the limit and returns the newest reply', async () => {
  let turns = 0
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    turns += 1
    thread.reply(command, fenced({ files: [String(turns)] }))
  })

  const result = await fake.turns.run(
    request({ copy: { editable: true, settle: () => Promise.resolve('Still broken.') } }),
  )

  expect(turns).toBe(1 + MAX_STRUCTURED_FOLLOW_UPS)
  expect(result).toEqual({ files: [String(turns)] })
})
