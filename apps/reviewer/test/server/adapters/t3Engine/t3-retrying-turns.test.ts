import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CommandTimeoutError } from '../../../../server/adapters/process'
import { EngineUnreachableError } from '../../../../server/adapters/t3Engine/engineLocation'
import {
  ProviderTurnError,
  TurnInterruptedError,
  type StructuredTurnRequest,
  type StructuredTurns,
} from '../../../../server/adapters/t3Engine/engineTurns'
import { RetryingTurns } from '../../../../server/adapters/t3Engine/retryingTurns'
import { Provider } from '../../../../shared/domain/types'

function request(signal = new AbortController().signal): StructuredTurnRequest<{ ok: boolean }> {
  return {
    model: { provider: Provider.codex, model: 'gpt-6.1-sol' },
    prompt: 'Review it.',
    schema: z.object({ ok: z.boolean() }),
    signal,
    observer: vi.fn(),
  }
}

/** Turns that fail with each error in order, then reply. */
function failing(...errors: Error[]) {
  const run = vi.fn(() => {
    const error = errors.shift()
    return error ? Promise.reject(error) : Promise.resolve({ ok: true })
  })
  return { turns: { run } as unknown as StructuredTurns, run }
}

describe('a structured turn that fails for a transient reason', () => {
  it.each([
    new TurnInterruptedError('Codex stopped before it finished.'),
    new EngineUnreachableError(),
    new ProviderTurnError('Codex failed: Selected model is at capacity. Please try again.'),
  ])('runs again after a pause and says so: %s', async (error) => {
    const { turns, run } = failing(error)
    const asked = request()

    const reply = await new RetryingTurns(turns, [0, 0]).run(asked)

    expect(reply).toEqual({ ok: true })
    expect(run).toHaveBeenCalledTimes(2)
    expect(asked.observer).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'activity', title: 'Retrying' }),
    )
  })

  it('gives up with the last failure once every pause is used', async () => {
    const last = new TurnInterruptedError('Claude stopped before it finished.')
    const { turns, run } = failing(
      new TurnInterruptedError('first'),
      new EngineUnreachableError(),
      last,
    )

    await expect(new RetryingTurns(turns, [0, 0]).run(request())).rejects.toBe(last)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('does not run again after a timeout, a task failure, or a cancellation', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    for (const [error, signal] of [
      [new CommandTimeoutError('Codex'), undefined],
      [new ProviderTurnError('Codex failed: The reply did not parse.'), undefined],
      [new TurnInterruptedError('Codex stopped before it finished.'), cancelled.signal],
    ] as const) {
      const { turns, run } = failing(error)

      await expect(new RetryingTurns(turns, [0, 0]).run(request(signal))).rejects.toBe(error)
      expect(run).toHaveBeenCalledOnce()
    }
  })
})
