import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileWithBob, reviewWithBob } from '../server/features/bob/bobReview'
import { runStructured } from '../server/adapters/provider'
import { Provider } from '../shared/domain/types'
import { fixtureBobAdvice, required } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/adapters/provider', () => ({ runStructured: vi.fn() }))
const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const signal = new AbortController().signal
beforeEach(() => {
  vi.mocked(runStructured).mockReset()
  vi.mocked(runStructured).mockResolvedValue(fixtureBobAdvice())
})

describe('Bob model prompts and reconciliation', () => {
  it('supplies the skill, numbered diff and repository inspection instructions for independent review', async () => {
    const repository = {
      directory: '/source',
      sha: fixturePull().headSha,
      url: 'http://localhost/mcp',
      token: 'token',
      close: vi.fn(),
    }
    await reviewWithBob({
      pull: fixturePull(),
      model,
      skill: 'Uncle Bob checklist and examples',
      signal,
      companion: true,
      repository,
    })
    const call = required(vi.mocked(runStructured).mock.calls[0])

    expect(call[1]).toContain('Uncle Bob checklist and examples')
    expect(call[1]).toContain('independent companion')
    expect(call[1]).toContain('oldLine')
    expect(call[1]).toContain('newLine')
    expect(call[1]).toContain('AGENTS.md')
    expect(call[1]).toContain('Do not modify code')
    expect(call[4]).toBe(repository)
  })
  it('reconciles evidence and discloses missing source, partial patches and a failed reviewer', async () => {
    const pull = fixturePull()
    required(pull.files[0]).coverage = 'partial'
    const reviews = [
      { model, advice: fixtureBobAdvice() },
      { model: { provider: Provider.claude, model: 'claude-opus-5-5' }, error: 'Failed' },
    ]
    const advice = await reconcileWithBob({
      pending: { pull, fingerprint: 'snapshot', reviews },
      model,
      skill: 'Skill',
      signal,
    })

    expect(required(vi.mocked(runStructured).mock.calls[0])[1]).toContain(JSON.stringify(reviews))
    expect(required(vi.mocked(runStructured).mock.calls[0])[1]).toContain('Deduplicate')
    expect(advice.limitations.join(' ')).toContain('Single-model review')
    expect(advice.limitations.join(' ')).toContain('incomplete')
    expect(advice.limitations.join(' ')).toContain('Repository rules')
  })
})
