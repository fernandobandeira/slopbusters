import { describe, expect, it, vi } from 'vitest'
import { cutWithLinus, type SplitTurnRequest } from '../server/features/split/splitTurns'
import type { SplitSession } from '../shared/domain/split'
import { Provider } from '../shared/domain/types'
import { recordingTurns } from './fixtures/turns'

const units = [
  {
    id: 'u1',
    path: 'a.ts',
    kind: 'hunk' as const,
    header: '@@ -1 +1 @@',
    additions: 1,
    deletions: 1,
  },
  { id: 'u2', path: 'b.ts', kind: 'file' as const, header: 'added', additions: 3, deletions: 0 },
]
const session: SplitSession = {
  id: 'split-1',
  repository: 'review-room/example',
  url: 'https://github.com/review-room/example/pull/128',
  number: 128,
  title: 'Require editor permissions',
  description: 'Viewers could edit projects.',
  headBranch: 'feature',
  baseBranch: 'main',
  headSha: 'head',
  baseSha: 'merge-base',
  primary: { provider: Provider.codex, model: 'gpt-6.1-sol' },
  companion: { provider: Provider.claude, model: 'claude-opus-5-5' },
  status: 'running',
  progress: '',
  createdAt: '',
  plan: [{ title: 'Add b', reason: 'Helper first', dependsOn: [], verification: 'tests' }],
  guidance: 'Keep the audit log with the rule.',
  units,
  turns: [],
  layers: [],
}
const cut = [
  { title: 'Add b', description: 'Helper.', units: ['u2'] },
  { title: 'Use b', description: 'Caller.', units: ['u1'] },
]

function request(reply: unknown, overrides: Partial<SplitTurnRequest> = {}) {
  const recording = recordingTurns(() => reply)
  const tryCut = vi.fn(() => Promise.resolve(undefined))
  const turn: SplitTurnRequest = {
    turns: recording.turns,
    session,
    skill: 'Linus split skill',
    role: 'primary',
    initial: true,
    model: session.primary,
    directory: '/tmp/split',
    units,
    patch: (id) => `patch of ${id}`,
    tryCut,
    signal: new AbortController().signal,
    ...overrides,
  }
  return { turn, tryCut, requests: recording.requests }
}

describe('a model turn as Linus on the stack', () => {
  it('reads the PR, the proposed layers, the guidance and the units, with Git kept in its copy', async () => {
    const { turn, tryCut, requests } = request({
      summary: 'Two layers.',
      approved: false,
      issues: [],
      layers: cut,
    })

    const reply = await cutWithLinus(turn)

    expect(reply.layers).toEqual(cut)
    expect(tryCut).toHaveBeenCalledWith(cut)
    const [sent] = requests
    expect(sent?.copy).toMatchObject({ git: true })
    expect(sent?.copy?.editable).toBeUndefined()
    expect(sent?.directory).toBe('/tmp/split')
    expect(sent?.prompt).toContain('Linus split skill')
    expect(sent?.prompt).toContain('Cut review-room/example PR #128 into a stack')
    expect(sent?.prompt).toContain('"title":"Add b","reason":"Helper first"')
    expect(sent?.prompt).toContain('Keep the audit log with the rule.')
    expect(sent?.prompt).toContain('### u1\npatch of u1')
    expect(sent?.prompt).toContain('git diff merge-base HEAD')
  })

  it('sends a cut that misses or repeats a unit back before building anything', async () => {
    const { turn, tryCut, requests } = request({
      summary: 'One layer.',
      approved: false,
      issues: [],
      layers: [{ title: 'All', description: 'Everything.', units: ['u1'] }],
    })

    await cutWithLinus(turn)

    expect(tryCut).not.toHaveBeenCalled()
    await expect(
      requests[0]?.copy?.settle?.('/tmp/copy', {
        summary: 'One layer.',
        approved: false,
        issues: [],
        layers: [{ title: 'All', description: 'Everything.', units: ['u1'] }],
      }),
    ).resolves.toBe(
      'The cut cannot be built:\n- A stack needs at least two layers.\n- Every unit must be in a layer; missing: u2.',
    )
  })
})

describe('approving the stack', () => {
  it('insists on a cut from the first turn, and accepts an approval once a stack stands', async () => {
    const approval = { summary: 'Fine.', approved: true, issues: [], layers: [] }
    const first = request(approval)
    await cutWithLinus(first.turn)
    await expect(
      first.requests[0]?.copy?.settle?.('/tmp/copy', { ...approval, layers: [] }),
    ).resolves.toContain('There is no stack yet.')

    const built = {
      ...session,
      layers: cut.map((layer, index) => ({
        ...layer,
        branch: `feature-${String(index + 1)}`,
        sha: String(index),
        additions: 1,
        deletions: 0,
      })),
    }
    const review = request(approval, { session: built, role: 'secondary', initial: false })
    await cutWithLinus(review.turn)
    await expect(
      review.requests[0]?.copy?.settle?.('/tmp/copy', { ...approval, layers: [] }),
    ).resolves.toBeUndefined()
    expect(review.requests[0]?.prompt).toContain('Review the stack built for')
    expect(review.requests[0]?.prompt).toContain('Current layers, bottom to top')
  })

  it('returns what stops a cut from building to the model', async () => {
    const { turn, requests } = request(
      { summary: 'Try.', approved: false, issues: [], layers: cut },
      { tryCut: () => Promise.resolve('Layer 2 "Use b" does not apply to a.ts') },
    )
    await cutWithLinus(turn)
    await expect(
      requests[0]?.copy?.settle?.('/tmp/copy', {
        summary: 'Try.',
        approved: false,
        issues: [],
        layers: cut,
      }),
    ).resolves.toBe('Layer 2 "Use b" does not apply to a.ts')
  })
})
