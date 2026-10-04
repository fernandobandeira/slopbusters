import { describe, expect, it } from 'vitest'
import { validateAdvice, recommendationsPrompt, type LinusAdvice } from '../shared/linus'
import { pullFingerprint } from '../server/linusReview'
import { Provider } from '../shared/types'
import { fixturePull } from './fixtures/pull'

export function fixtureAdvice(): LinusAdvice {
  const pull = fixturePull()
  return {
    verdict: 'keep',
    reasoning: 'Keep the permission check and its tests together.',
    revisedTitle: 'access: Require editor permissions for project updates',
    revisedDescription:
      'Require an editor role before updating projects. Check tenant isolation and the role tests.',
    layers: [],
    limitations: ['Repository templates and test execution were not supplied.'],
    disagreements: [],
    steps: [
      {
        text: 'Keep this change together. The tests prove the permission rule.',
        emotion: 'happy',
        target: 'overview',
        reference: '',
      },
      {
        text: 'Explain why the permission rule changed.',
        emotion: 'neutral',
        target: 'description',
        reference: 'Tighten project edit permissions',
      },
      {
        text: 'The role guard is the main review point.',
        emotion: 'thinking',
        target: 'diff',
        reference: pull.files[0].hunks[0].id,
      },
    ],
  }
}

describe('Linus evidence and recommendations', () => {
  it('accepts exact passages and real diff sections; rejects invented evidence and expressions', () => {
    const pull = fixturePull()
    expect(validateAdvice(pull, fixtureAdvice()).steps).toHaveLength(3)
    const advice = fixtureAdvice()
    advice.steps[1].reference = 'This quote is invented'
    expect(() => validateAdvice(pull, advice)).toThrow(/passage/)
    advice.steps[1] = { ...advice.steps[1], target: 'diff', reference: 'another-pr-hunk' }
    expect(() => validateAdvice(pull, advice)).toThrow(/diff section/)
    expect(() =>
      validateAdvice(pull, {
        ...fixtureAdvice(),
        steps: [{ ...fixtureAdvice().steps[0], emotion: '../../other' }],
      }),
    ).toThrow()
  })
  it('rejects reviews longer than three turns or overly long dialogue', () => {
    const advice = fixtureAdvice()
    advice.steps.push({ ...advice.steps[0] })
    expect(() => validateAdvice(fixturePull(), advice)).toThrow()
    advice.steps = [{ ...advice.steps[0], text: 'x'.repeat(501) }]
    expect(() => validateAdvice(fixturePull(), advice)).toThrow()
  })
  it('distinguishes dependency stacks from independent changes and rejects forward/cyclic dependencies', () => {
    const advice = fixtureAdvice()
    advice.verdict = 'stack'
    const layer = {
      title: 'Guard updates',
      reason: 'Proves authorization independently',
      verification: 'Run the role tests',
      dependsOn: [] as number[],
    }
    advice.layers = [layer, { ...layer, title: 'Add audit behavior', dependsOn: [1] }]
    expect(validateAdvice(fixturePull(), advice).verdict).toBe('stack')
    advice.layers[0].dependsOn = [2]
    expect(() => validateAdvice(fixturePull(), advice)).toThrow(/earlier/)
    advice.layers[0].dependsOn = []
    advice.verdict = 'separate'
    expect(() => validateAdvice(fixturePull(), advice)).toThrow(/Independent/)
    advice.layers[1].dependsOn = []
    expect(validateAdvice(fixturePull(), advice).verdict).toBe('separate')
    advice.verdict = 'stack'
    expect(() => validateAdvice(fixturePull(), advice)).toThrow(/dependencies/)
  })
  it('invalidates the evidence fingerprint when code, title, or description changes', () => {
    const pull = fixturePull()
    const original = pullFingerprint(pull)
    expect(
      pullFingerprint({ ...pull, description: `${pull.description}\nMore rationale.` }),
    ).not.toBe(original)
    expect(pullFingerprint({ ...pull, title: 'A revised title' })).not.toBe(original)
    expect(pullFingerprint({ ...pull, headSha: 'new-head' })).not.toBe(original)
    expect(pullFingerprint({ ...pull, baseSha: 'new-base' })).not.toBe(original)
    expect(pullFingerprint({ ...pull, groups: [] })).toBe(original)
  })
  it('exports actionable wording, revisions, evidence and caveats instead of only dialogue', () => {
    const pull = fixturePull()
    const advice = fixtureAdvice()
    advice.disagreements = [
      'The independent extraction may merit a separate PR; inspect its callers first.',
    ]
    const prompt = recommendationsPrompt([
      {
        pull,
        advice,
        fingerprint: pullFingerprint(pull),
        reviewers: [{ provider: Provider.codex, model: 'gpt-6.1-sol' }],
      },
    ])
    for (const text of [
      pull.url,
      pull.headSha,
      pull.baseSha,
      advice.revisedTitle,
      advice.revisedDescription,
      advice.limitations[0],
      advice.disagreements[0],
      advice.steps[2].reference,
    ])
      expect(prompt).toContain(text)
    expect(prompt).toContain('approval before executing')
  })
})
