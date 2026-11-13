import { expect, it } from 'vitest'
import { z } from 'zod'
import { fakeEngine } from './fixtures/fakeEngine'

const request = () => ({
  thread: {
    threadId: 'worker-thread',
    messageId: 'first-message',
    runtimeMode: 'full-access' as const,
  },
  model: { instanceId: 'codex', model: 'test-model' },
  message: 'Apply the fix.',
  schema: z.object({ summary: z.string() }),
  signal: new AbortController().signal,
})

it('collects command evidence and corrects a report in the retained thread once', async () => {
  let turns = 0
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    turns++
    thread.startTurn(command)
    thread.item('command_execution', {
      input: 'pnpm test',
      exitCode: 1,
      outputIndicatesFailure: true,
    })
    thread.assistant(turns === 1 ? 'invalid' : '{"summary":"checked"}')
    thread.run('completed')
  })
  const result = await fake.threadTurns.run(request())
  expect(result.report).toEqual({ summary: 'checked' })
  expect(result.commands).toHaveLength(2)
  expect(result.commands[0]).toMatchObject({
    input: 'pnpm test',
    exitCode: 1,
    outputIndicatesFailure: true,
  })
  expect(fake.types()).toEqual(['message.dispatch', 'message.dispatch'])
  expect(new Set(fake.commands.map((command) => command.threadId)).size).toBe(1)
})

it('sends and follows a follow-up in the same thread', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.reply(command, '{"summary":"done"}')
  })
  await fake.threadTurns.run(request())
  await fake.threadTurns.run({ ...request(), message: 'Correct the partial fix.' })
  expect(fake.commands.map((command) => command.text)).toEqual([
    'Apply the fix.',
    'Correct the partial fix.',
  ])
})

it.each(['failed', 'interrupted', 'cancelled'] as const)('follows a %s run', async (status) => {
  const fake = fakeEngine((command, thread) => {
    if (command.type !== 'message.dispatch') return
    thread.startTurn(command)
    thread.run(status)
  })
  const result = await fake.threadTurns.run(request())
  expect(result.outcome.status).toBe(status === 'failed' ? 'failed' : 'interrupted')
  expect(result.report).toBeUndefined()
})

it('interrupts on timeout and cancellation', async () => {
  const fake = fakeEngine((command, thread) => {
    if (command.type === 'message.dispatch') thread.startTurn(command)
  })
  const timed = await fake.threadTurns.run({ ...request(), timeoutMs: 5 })
  expect(timed.outcome.status).toBe('timeout')
  const controller = new AbortController()
  controller.abort()
  const cancelled = await fake.threadTurns.run({ ...request(), signal: controller.signal })
  expect(cancelled.outcome.status).toBe('cancelled')
  expect(fake.types()).toContain('run.interrupt')
})
