import { ownProcedureOnly } from '../server/features/reviewPrompts'
import { describe, expect, it, vi } from 'vitest'
import { reconcileWithBob, reviewWithBob } from '../server/features/bob/bobReview'
import { Provider } from '../shared/domain/types'
import { fixtureBobAdvice, required } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const signal = new AbortController().signal

describe('Bob model prompts and reconciliation', () => {
  it('supplies the skill, numbered diff and repository inspection instructions for independent review', async () => {
    const { turns, requests } = recordingTurns(() => fixtureBobAdvice())
    const repository = { directory: '/source', sha: fixturePull().headSha, release: vi.fn() }
    const observer = vi.fn()
    await reviewWithBob({
      turns,
      pull: fixturePull(),
      model,
      skill: 'Uncle Bob checklist and examples',
      signal,
      companion: true,
      repository,
      observer,
    })
    const request = required(requests[0])

    expect(request.prompt).toContain('Uncle Bob checklist and examples')
    expect(request.prompt).toContain('independent companion')
    expect(request.prompt).toContain('oldLine')
    expect(request.prompt).toContain('newLine')
    expect(request.prompt).toContain('AGENTS.md')
    expect(request.prompt).toContain('Do not modify code')
    expect(request.prompt).toContain('The current directory is the repository at saved head')
    expect(request).toMatchObject({
      model,
      signal,
      directory: '/source',
      observer,
      purpose: 'Uncle Bob companion review · review-room/example#128',
    })
  })
  it('reconciles evidence and discloses missing source, partial patches and a failed reviewer', async () => {
    const { turns, requests } = recordingTurns(() => fixtureBobAdvice())
    const pull = fixturePull()
    required(pull.files[0]).coverage = 'partial'
    const reviews = [
      { model, advice: fixtureBobAdvice() },
      { model: { provider: Provider.claude, model: 'claude-opus-5-5' }, error: 'Failed' },
    ]
    const advice = await reconcileWithBob({
      turns,
      pending: { pull, fingerprint: 'snapshot', reviews },
      model,
      skill: 'Skill',
      signal,
    })
    const request = required(requests[0])

    expect(request.prompt).toContain(JSON.stringify(reviews))
    expect(request.prompt).toContain('Deduplicate')
    expect(request.prompt).toContain(ownProcedureOnly)
    expect(request.directory).toBeUndefined()
    expect(request.purpose).toBe('Uncle Bob reconciliation · review-room/example#128')
    expect(advice.limitations.join(' ')).toContain('Single-model review')
    expect(advice.limitations.join(' ')).toContain('incomplete')
    expect(advice.limitations.join(' ')).toContain('Repository rules')
  })
})
