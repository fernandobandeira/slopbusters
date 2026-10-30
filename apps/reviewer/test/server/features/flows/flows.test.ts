import { describe, expect, it, vi } from 'vitest'
import { UserError } from '../../../../server/errors'
import {
  debate,
  unanimousApproval,
  type DebateMove,
} from '../../../../server/features/flows/debate'
import { FlowJobs, type FlowSession } from '../../../../server/features/flows/flowJobs'
import { failedSeats, reviewSeats } from '../../../../server/features/flows/panel'

const failure = { fallback: 'The flow stopped.', progress: 'Stopped. Earlier work is saved.' }

function session(): FlowSession {
  return { id: 'flow', status: 'running', progress: 'Starting…' }
}

describe('flow jobs', () => {
  it('fails a session whose work throws, with a message safe to show', async () => {
    const save = vi.fn()
    const jobs = new FlowJobs<FlowSession>({ save, failure })
    const flow = session()

    jobs.launch(flow, () => Promise.reject(new Error('private detail')))
    await jobs.stop(() => undefined)

    expect(flow).toMatchObject({ status: 'failed', error: failure.fallback })
    expect(flow.progress).toBe(failure.progress)
    expect(jobs.isRunning(flow.id)).toBe(false)
  })

  it('leaves a cancelled session alone when its work rejects on the abort', async () => {
    const jobs = new FlowJobs<FlowSession>({ save: vi.fn(), failure })
    const flow = session()
    jobs.launch(
      flow,
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('Cancelled'))
          })
        }),
    )

    await jobs.stop((running) => {
      jobs.abort(running.id)
    })

    expect(flow.status).toBe('running')
    expect(jobs.active()).toEqual([])
  })

  it('cancels a session saved as running that no job runs', () => {
    const jobs = new FlowJobs<FlowSession>({ save: vi.fn(), failure })

    const recovered = jobs.recover(session(), 'Interrupted when the app stopped.')

    expect(recovered).toMatchObject({
      status: 'cancelled',
      progress: 'Interrupted when the app stopped.',
    })
  })
})

describe('panel seats', () => {
  it('records a failed seat beside the others, in seat order', async () => {
    const landed: string[] = []

    const outcomes = await reviewSeats(['bob', 'linus', 'avery'], {
      signal: new AbortController().signal,
      concurrency: 2,
      review: (seat) =>
        seat === 'linus'
          ? Promise.reject(new UserError('Linus timed out.'))
          : Promise.resolve(seat),
      failure: (seat) => `${seat} failed.`,
      landed: (seat) => landed.push(seat),
    })

    expect(outcomes).toEqual([
      { advice: 'bob' },
      { error: 'Linus timed out.' },
      { advice: 'avery' },
    ])
    expect(landed.sort()).toEqual(['avery', 'bob', 'linus'])
  })

  it('takes no more seats once the panel is cancelled', async () => {
    const controller = new AbortController()
    const review = vi.fn((seat: string) => {
      controller.abort()
      return Promise.reject(new Error(`${seat} cancelled`))
    })

    const run = reviewSeats(['bob', 'linus'], {
      signal: controller.signal,
      concurrency: 1,
      review,
      failure: () => 'failed',
    })

    await expect(run).rejects.toThrow()
    expect(review).toHaveBeenCalledTimes(1)
  })

  it('returns the failed seats, and throws every error when none reviewed', () => {
    const partial = [{ advice: 'bob' }, { error: 'Linus timed out.' }]
    const none = [{ error: 'Bob timed out.' }, { error: 'Linus timed out.' }]
    const describe = (outcome: { error?: string }) => outcome.error ?? 'No review.'

    const failed = failedSeats(partial, describe)

    expect(failed).toEqual([{ error: 'Linus timed out.' }])
    expect(() => failedSeats(none, describe)).toThrow('Bob timed out.\nLinus timed out.')
  })
})

describe('debate', () => {
  const roles = ['primary', 'secondary'] as const
  const stalled = () => new Error('No agreement.')

  function scripted(moves: DebateMove[]) {
    return vi.fn((_role: string, _index: number) =>
      Promise.resolve(moves.shift() ?? { changed: false, approved: false }),
    )
  }

  it('ends when every role approves with nothing changed since', async () => {
    const turn = scripted([
      { changed: true, approved: false },
      { changed: false, approved: true },
      { changed: false, approved: true },
    ])

    const turns = await debate({
      roles,
      maxTurns: 10,
      signal: new AbortController().signal,
      consensus: unanimousApproval(roles),
      turn,
      stalled,
    })

    expect(turns).toBe(3)
    expect(turn.mock.calls.map(([role]) => role)).toEqual(['primary', 'secondary', 'primary'])
  })

  it('starts the approvals over when a turn changes the shared state', async () => {
    const turn = scripted([
      { changed: false, approved: true },
      { changed: true, approved: false },
      { changed: false, approved: true },
      { changed: false, approved: true },
    ])

    const turns = await debate({
      roles,
      maxTurns: 10,
      signal: new AbortController().signal,
      consensus: unanimousApproval(roles),
      turn,
      stalled,
    })

    expect(turns).toBe(4)
  })

  it('stops after the turn cap without agreement', async () => {
    const run = debate({
      roles,
      maxTurns: 3,
      signal: new AbortController().signal,
      consensus: unanimousApproval(roles),
      turn: scripted([]),
      stalled,
    })

    await expect(run).rejects.toThrow('No agreement.')
  })
})
