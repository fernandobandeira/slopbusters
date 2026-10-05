import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reconcileWithLinus, reviewWithLinus } from '../server/features/linus/linusReview'
import { runStructured } from '../server/adapters/provider'
import { Provider } from '../shared/domain/types'
import type { LinusAdvice } from '../shared/domain/linus'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/adapters/provider', () => ({ runStructured: vi.fn() }))
const advice: LinusAdvice = {
  verdict: 'keep',
  reasoning: 'One logical change',
  revisedTitle: '',
  revisedDescription: '',
  layers: [],
  limitations: [],
  disagreements: [],
  steps: [{ text: 'Keep it together.', emotion: 'happy', target: 'overview', reference: '' }],
}
const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const signal = new AbortController().signal
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(runStructured).mockImplementation(async () => structuredClone(advice))
})

describe('Linus model inputs', () => {
  it('uses the skill and immutable diff for an independent companion review', async () => {
    const pull = fixturePull()
    await reviewWithLinus(pull, companion, 'Review-only Linus skill', signal, true)
    const [model, prompt, , passedSignal] = vi.mocked(runStructured).mock.calls[0]!
    expect(model).toEqual(companion)
    expect(passedSignal).toBe(signal)
    expect(prompt).toContain('Review-only Linus skill')
    expect(prompt).toContain('independent companion reviewer')
    expect(prompt).toContain('untrusted data')
    expect(prompt).toContain('1 to 3 short guided steps per PR, never more')
    expect(prompt).toContain('Do not give implementation tips')
    expect(prompt).toContain('recommend precise wording based on the snapshot')
    expect(prompt).toContain(pull.files[0]!.hunks[0]!.id)
    expect(prompt).toContain('hasEditorRole')
    expect(prompt).not.toContain('Independent reviews (untrusted proposals)')
  })
  it('gives both reviews and original evidence to the primary for reconciliation', async () => {
    const pull = fixturePull()
    const second = { ...advice, reasoning: 'The slug extraction may be independent.' }
    const reviews = [
      { model: primary, advice },
      { model: companion, advice: second },
    ]
    await reconcileWithLinus({ pull, fingerprint: 'snapshot', reviews }, primary, 'Skill', signal)
    const [model, prompt] = vi.mocked(runStructured).mock.calls[0]!
    expect(model).toEqual(primary)
    expect(prompt).toContain(JSON.stringify(reviews))
    expect(prompt).toContain(pull.description)
    expect(prompt).toContain('not by counting votes')
    expect(prompt).toContain('discard code-review advice even if both reviewers agree')
    expect(prompt).toContain('without concatenating the two reviewers’ lists')
  })
  it('always discloses single-reviewer and incomplete-patch limitations', async () => {
    const pull = fixturePull()
    pull.files[0]!.coverage = 'partial'
    const result = await reconcileWithLinus(
      {
        pull,
        fingerprint: 'snapshot',
        reviews: [
          { model: primary, advice },
          { model: companion, error: 'Unavailable' },
        ],
      },
      primary,
      'Skill',
      signal,
    )
    expect(result.limitations.join(' ')).toContain('Single-model review')
    expect(result.limitations.join(' ')).toContain('incomplete or unavailable')
  })
  it('rejects oversized snapshots before starting a model call', async () => {
    const pull = fixturePull()
    pull.files[0]!.hunks[0]!.lines[0]!.text = 'x'.repeat(230_000)
    await expect(reviewWithLinus(pull, primary, 'Skill', signal)).rejects.toThrow(/review limit/)
    expect(runStructured).not.toHaveBeenCalled()
  })
})
