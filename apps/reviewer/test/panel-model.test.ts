import { describe, expect, it } from 'vitest'
import {
  seatReviewer,
  normalizeJudgeAdvice,
  normalizePanelAdvice,
  panelCommentBody,
  rankFindings,
} from '../shared/domain/panel'
import { panelReviewerMarkdown } from '../shared/domain/panelMarkdown'
import { fixtureJudgeAdvice, fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
import { fixturePull } from './fixtures/pull'

const pull = fixturePull()

describe('a panel reviewer’s advice', () => {
  it('drops findings that do not point at a changed line and says so', () => {
    const elsewhere = fixturePanelFinding({ id: 'context', line: 99_999 })

    const advice = normalizePanelAdvice(
      pull,
      fixturePanelAdvice([fixturePanelFinding(), elsewhere]),
      10,
    )

    expect(advice.findings.map((finding) => finding.id)).toEqual(['reuse-audit-helper'])
    expect(advice.limitations.join(' ')).toMatch(/Dropped 1 findings/)
  })

  it('keeps the reviewer’s own ranking up to its cap', () => {
    const findings = [
      fixturePanelFinding({ id: 'question', tag: 'decision', severity: 'must-fix' }),
      fixturePanelFinding({ id: 'rule', tag: 'convention', severity: 'consider' }),
      fixturePanelFinding({ id: 'code', tag: 'code', severity: 'should-fix' }),
    ]

    const advice = normalizePanelAdvice(pull, fixturePanelAdvice(findings), 2)

    expect(advice.findings.map((finding) => finding.id)).toEqual(['question', 'rule'])
    expect(advice.limitations).toContain('Kept the first 2 of 3 ranked findings.')
  })

  it('makes the verdict agree with the findings that are left', () => {
    const empty = { ...fixturePanelAdvice([]), verdict: 'changes' as const }
    const clean = { ...fixturePanelAdvice(), verdict: 'clean' as const }

    expect(normalizePanelAdvice(pull, empty, 10).verdict).toBe('uncertain')
    expect(normalizePanelAdvice(pull, clean, 10).verdict).toBe('changes')
  })
})

describe('the judge’s advice', () => {
  it('keeps only reviewers on the panel in raisedBy and drops findings nobody on it raised', () => {
    const advice = fixtureJudgeAdvice(['unclebob', 'teammate:ghost'])
    advice.findings.push({ ...fixturePanelFinding({ id: 'invented' }), raisedBy: ['judge'] })

    const judged = normalizeJudgeAdvice(pull, advice, ['unclebob', 'terminator'])

    expect(judged.findings.map((finding) => [finding.id, finding.raisedBy])).toEqual([
      ['reuse-audit-helper', ['unclebob']],
    ])
    expect(judged.limitations.join(' ')).toMatch(/no reviewer on the panel raised/)
  })
})

describe('ranking and comments', () => {
  it('puts repository rules first, then code, then questions, by severity within each', () => {
    const ranked = rankFindings([
      { tag: 'decision', severity: 'must-fix' },
      { tag: 'code', severity: 'consider' },
      { tag: 'code', severity: 'must-fix' },
      { tag: 'convention', severity: 'consider' },
    ] as const)

    expect(ranked.map((finding) => `${finding.tag}:${finding.severity}`)).toEqual([
      'convention:consider',
      'code:must-fix',
      'code:consider',
      'decision:must-fix',
    ])
  })

  it('starts a decision’s comment as the question, without a suggested fix', () => {
    const question = fixturePanelFinding({ tag: 'decision', body: 'Should admins see this?' })

    expect(panelCommentBody(question)).toBe('Reuse the audit helper\n\nShould admins see this?')
    expect(panelCommentBody(fixturePanelFinding())).toContain('Call auditProjectUpdate')
  })

  it('tells a continuing reviewer which of its findings the judge kept and set aside', () => {
    const judged = fixtureJudgeAdvice(['terminator'])
    judged.setAside.push({
      title: 'Rename the helper',
      body: 'A taste call.',
      raisedBy: ['unclebob'],
      reason: 'No rule asks for it.',
    })
    const bob = { id: 'unclebob' as const, name: 'Uncle Bob', maxFindings: 10 }

    const markdown = panelReviewerMarkdown(bob, fixturePanelAdvice(), judged)

    expect(markdown).toContain('The judge kept none of your findings.')
    expect(markdown).toContain('*Set aside:* No rule asks for it.')
  })
})

describe('seats', () => {
  it('maps a seat to its reviewer, reading the Terminator’s old name from earlier sessions', () => {
    expect(seatReviewer('unclebob@codex')).toBe('unclebob')
    expect(seatReviewer('teammate:avery@claude')).toBe('teammate:avery')
    expect(seatReviewer('rules')).toBe('terminator')
    expect(seatReviewer('rules@codex')).toBe('terminator')
  })
})
