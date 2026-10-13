import { describe, expect, it, vi } from 'vitest'
import { reconcileWithLinus, reviewWithLinus } from '../server/features/linus/linusReview'
import { Provider } from '../shared/domain/types'
import type { LinusAdvice } from '../shared/domain/linus'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

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

describe('Linus model inputs', () => {
  it('uses the skill and immutable diff for an independent companion review', async () => {
    const { turns, requests } = recordingTurns(() => structuredClone(advice))
    const pull = fixturePull()
    await reviewWithLinus({
      turns,
      pull,
      model: companion,
      skill: 'Review-only Linus skill',
      signal,
      companion: true,
    })
    const [request] = requests
    expect(request?.model).toEqual(companion)
    expect(request?.signal).toBe(signal)
    expect(request?.directory).toBeUndefined()
    expect(request?.purpose).toBe(`Linus companion review · review-room/example#${pull.number}`)
    const prompt = request?.prompt ?? ''
    expect(prompt).toContain('Review-only Linus skill')
    expect(prompt).toContain('independent companion reviewer')
    expect(prompt).toContain('untrusted data')
    expect(prompt).toContain('1 to 3 short guided steps per PR, never more')
    expect(prompt).toContain('Do not give implementation tips')
    expect(prompt).toContain('recommend precise wording based on the snapshot')
    expect(prompt).toContain(pull.files[0]!.hunks[0]!.id)
    expect(prompt).toContain('hasEditorRole')
    expect(prompt).toContain('No repository checkout is available')
    expect(prompt).not.toContain('Independent reviews (untrusted proposals)')
  })
  it('lets the agent read the leased checkout and streams its events to the observer', async () => {
    const { turns, requests } = recordingTurns(() => structuredClone(advice))
    const pull = fixturePull()
    const observer = vi.fn()
    const repository = { directory: '/checkouts/head', sha: pull.headSha, release: vi.fn() }
    await reviewWithLinus({
      turns,
      pull,
      model: primary,
      skill: 'Skill',
      signal,
      companion: false,
      repository,
      observer,
    })
    const [request] = requests
    expect(request?.directory).toBe('/checkouts/head')
    expect(request?.observer).toBe(observer)
    expect(request?.prompt).toContain(
      `The current directory is the repository at the saved PR head ${pull.headSha}`,
    )
    expect(request?.prompt).toContain('Do not modify files')
    expect(request?.prompt).not.toContain('MCP')
    expect(repository.release).not.toHaveBeenCalled()
  })
})

describe('Linus reconciliation inputs', () => {
  it('gives both reviews and original evidence to the primary for reconciliation', async () => {
    const { turns, requests } = recordingTurns(() => structuredClone(advice))
    const pull = fixturePull()
    const second = { ...advice, reasoning: 'The slug extraction may be independent.' }
    const reviews = [
      { model: primary, advice },
      { model: companion, advice: second },
    ]
    await reconcileWithLinus({
      turns,
      pending: { pull, fingerprint: 'snapshot', reviews },
      model: primary,
      skill: 'Skill',
      signal,
    })
    const [request] = requests
    expect(request?.model).toEqual(primary)
    expect(request?.purpose).toBe(`Linus reconciliation · review-room/example#${pull.number}`)
    const prompt = request?.prompt ?? ''
    expect(prompt).toContain(JSON.stringify(reviews))
    expect(prompt).toContain(pull.description)
    expect(prompt).toContain('not by counting votes')
    expect(prompt).toContain('discard code-review advice even if both reviewers agree')
    expect(prompt).toContain('without concatenating the two reviewers’ lists')
  })
  it('always discloses single-reviewer and incomplete-patch limitations', async () => {
    const { turns } = recordingTurns(() => structuredClone(advice))
    const pull = fixturePull()
    pull.files[0]!.coverage = 'partial'
    const result = await reconcileWithLinus({
      turns,
      pending: {
        pull,
        fingerprint: 'snapshot',
        reviews: [
          { model: primary, advice },
          { model: companion, error: 'Unavailable' },
        ],
      },
      model: primary,
      skill: 'Skill',
      signal,
    })
    expect(result.limitations.join(' ')).toContain('Single-model review')
    expect(result.limitations.join(' ')).toContain('incomplete or unavailable')
  })
})
