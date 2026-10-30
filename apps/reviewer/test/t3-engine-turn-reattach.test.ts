import { expect, it } from 'vitest'
import { z } from 'zod'
import { Provider } from '../shared/domain/types'
import { MAX_T3_ENGINE_TURN_REATTACHES } from '../server/adapters/t3Engine/limits'
import { fakeEngine } from './fixtures/fakeEngine'

const filesSchema = z.object({ files: z.array(z.string()) })

const request = () => ({
  model: { provider: Provider.codex, model: 'gpt-6-astra' },
  prompt: 'List the top-level files.',
  schema: filesSchema,
  signal: new AbortController().signal,
  purpose: 'grounding',
})

const reply = (files: string[]) => JSON.stringify({ files })

const lifecycle = (...turns: string[]) => [
  'project.create',
  'thread.create',
  ...turns,
  'thread.archive',
  'project.delete',
]

function threadOf(fake: ReturnType<typeof fakeEngine>) {
  return fake.thread(fake.commands.find((command) => command.type === 'thread.create')?.threadId)
}

it('follows a running turn again after the engine socket drops, without resending the prompt', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    thread.startTurn(command)
    thread.drop()
    thread.assistant(reply(['after-wake.ts']))
    thread.run('completed')
  })

  const result = await fake.turns.run(request())

  expect(result).toEqual({ files: ['after-wake.ts'] })
  expect(fake.types()).toEqual(lifecycle('message.dispatch'))
  expect(threadOf(fake).subscriptions).toBe(2)
})

it('sends the prompt again, with the same command, when the engine lost it in the drop', async () => {
  let dispatches = 0
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    dispatches += 1
    if (dispatches === 1) thread.drop()
    else thread.reply(command, reply(['resent.ts']))
  })

  const result = await fake.turns.run(request())

  expect(result).toEqual({ files: ['resent.ts'] })
  expect(fake.types()).toEqual(lifecycle('message.dispatch', 'message.dispatch'))
  const [first, second] = fake.commands.filter((command) => command.type === 'message.dispatch')
  expect(second?.commandId).toBe(first?.commandId)
})

it('gives up on a turn whose engine socket keeps dropping, and still archives', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    thread.startTurn(command)
    thread.unreachable = true
    thread.drop()
  })

  await expect(fake.turns.run(request())).rejects.toThrow('ping timeout')

  expect(fake.types()).toEqual(lifecycle('message.dispatch'))
  expect(threadOf(fake).subscriptions).toBe(MAX_T3_ENGINE_TURN_REATTACHES + 1)
})
