import { describe, expect, it } from 'vitest'
import {
  seatReviewer,
  judgeAdviceSchema,
  normalizeJudgeAdvice,
  normalizePanelAdvice,
  panelCommentBody,
  panelCommentsInline,
  panelDraftComment,
  rankFindings,
} from '../shared/domain/panel'
import { DiffSide } from '../shared/domain/types'
import { panelReviewerMarkdown } from '../shared/domain/panelMarkdown'
import { fixtureJudgeAdvice, fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
import { fixturePull } from './fixtures/pull'

const pull = fixturePull()
const changeAnchor = (() => {
  const { anchor } = fixturePanelFinding()
  if (anchor.kind !== 'change') throw new Error('The fixture finding is on a changed line.')
  return anchor
})()

describe('a panel reviewer’s advice', () => {
  it('keeps a finding it cannot place apart, with the reason, instead of moving it', () => {
    const elsewhere = fixturePanelFinding({
      id: 'context',
      anchor: { ...changeAnchor, line: 99_999 },
    })

    const { advice, unplaced } = normalizePanelAdvice(
      { pull },
      fixturePanelAdvice([fixturePanelFinding(), elsewhere]),
      10,
    )

    expect(advice.findings.map((finding) => finding.id)).toEqual(['reuse-audit-helper'])
    expect(unplaced).toEqual([
      {
        finding: elsewhere,
        problem: `${changeAnchor.path}:99999 is not a changed line of the snapshot.`,
      },
    ])
    expect(advice.limitations.join(' ')).toMatch(/1 findings point at a location/)
  })

  it('keeps the reviewer’s own ranking up to its cap', () => {
    const findings = [
      fixturePanelFinding({ id: 'question', tag: 'decision', severity: 'must-fix' }),
      fixturePanelFinding({ id: 'rule', tag: 'convention', severity: 'consider' }),
      fixturePanelFinding({ id: 'code', tag: 'code', severity: 'should-fix' }),
    ]

    const { advice } = normalizePanelAdvice({ pull }, fixturePanelAdvice(findings), 2)

    expect(advice.findings.map((finding) => finding.id)).toEqual(['question', 'rule'])
    expect(advice.limitations).toContain('Kept the first 2 of 3 ranked findings.')
  })

  it('makes the verdict agree with the findings that are left', () => {
    const empty = { ...fixturePanelAdvice([]), verdict: 'changes' as const }
    const clean = { ...fixturePanelAdvice(), verdict: 'clean' as const }

    expect(normalizePanelAdvice({ pull }, empty, 10).advice.verdict).toBe('uncertain')
    expect(normalizePanelAdvice({ pull }, clean, 10).advice.verdict).toBe('changes')
  })
})

describe('a finding’s anchor', () => {
  it('places context lines, the description and other layers against the evidence', () => {
    const layer = {
      ...pull,
      number: 131,
      url: pull.url.replace(/128$/, '131'),
      title: 'Add slug helper',
    }
    const findings = [
      fixturePanelFinding({
        id: 'caller',
        anchor: { kind: 'context', path: 'src/server/router.ts', line: 40, side: DiffSide.right },
      }),
      fixturePanelFinding({
        id: 'nowhere',
        anchor: { kind: 'context', path: 'src/missing.ts', line: 3, side: DiffSide.right },
      }),
      fixturePanelFinding({
        id: 'in-hunk',
        anchor: {
          kind: 'context',
          path: changeAnchor.path,
          hunkId: changeAnchor.hunkId,
          line: 9,
          side: DiffSide.right,
        },
      }),
      fixturePanelFinding({
        id: 'title',
        anchor: { kind: 'description', field: 'title', quote: 'editor  permissions' },
      }),
      fixturePanelFinding({
        id: 'misquote',
        anchor: { kind: 'description', field: 'description', quote: 'not in the text' },
      }),
      fixturePanelFinding({
        id: 'below',
        anchor: { kind: 'stack', pull: 131, location: { kind: 'description', field: 'title' } },
      }),
      fixturePanelFinding({
        id: 'unknown-layer',
        anchor: { kind: 'stack', pull: 140, location: { kind: 'description', field: 'title' } },
      }),
    ]

    const { advice, unplaced } = normalizePanelAdvice(
      {
        pull,
        layers: [{ pull: layer, fingerprint: 'layer-131' }],
        sourceHas: (path) => path === 'src/server/router.ts',
      },
      fixturePanelAdvice(findings),
      10,
    )

    expect(advice.findings.map((finding) => finding.id)).toEqual([
      'caller',
      'in-hunk',
      'title',
      'below',
    ])
    expect(advice.findings.at(-1)?.anchor).toMatchObject({
      kind: 'stack',
      fingerprint: 'layer-131',
    })
    expect(unplaced.map(({ finding }) => finding.id)).toEqual([
      'nowhere',
      'misquote',
      'unknown-layer',
    ])
  })
})

describe('where a finding goes in the review draft', () => {
  it('comments inline on changed and in-hunk lines, and in the summary otherwise', () => {
    const inHunk = fixturePanelFinding({
      anchor: {
        kind: 'context',
        path: changeAnchor.path,
        hunkId: changeAnchor.hunkId,
        line: 9,
        side: DiffSide.right,
      },
    })
    const offHunk = fixturePanelFinding({
      anchor: { kind: 'context', path: 'src/server/router.ts', line: 40, side: DiffSide.right },
    })
    const description = fixturePanelFinding({
      anchor: { kind: 'description', field: 'description' },
    })

    expect(panelCommentsInline(pull, fixturePanelFinding())).toBe(true)
    expect(panelDraftComment(pull, inHunk, 'Same here.')).toMatchObject({
      path: changeAnchor.path,
      line: 9,
    })
    expect(panelCommentsInline(pull, offHunk)).toBe(false)
    expect(panelCommentsInline(pull, description)).toBe(false)
    expect(() => panelDraftComment(pull, description, 'Say why.')).toThrow(/review summary/)
  })
})

describe('the judge’s advice', () => {
  it('keeps only reviewers on the panel in raisedBy and drops findings nobody on it raised', () => {
    const advice = fixtureJudgeAdvice(['unclebob', 'teammate:ghost'])
    advice.findings.push({ ...fixturePanelFinding({ id: 'invented' }), raisedBy: ['judge'] })

    const judged = normalizeJudgeAdvice({ pull }, advice, ['unclebob', 'terminator'])

    expect(judged.findings.map((finding) => [finding.id, finding.raisedBy])).toEqual([
      ['reuse-audit-helper', ['unclebob']],
    ])
    expect(judged.limitations.join(' ')).toMatch(/no reviewer on the panel raised/)
  })
})

describe('a judged finding the evidence cannot place', () => {
  it('is set aside with the reason, within the set-aside limits', () => {
    const advice = fixtureJudgeAdvice(['unclebob'])
    advice.findings.push({
      ...fixturePanelFinding({
        id: 'far',
        body: 'x'.repeat(3000),
        anchor: {
          kind: 'context',
          path: `src/${'deep/'.repeat(150)}gone.ts`,
          line: 3,
          side: DiffSide.right,
        },
      }),
      raisedBy: ['unclebob'],
    })

    const judged = normalizeJudgeAdvice({ pull }, advice, ['unclebob'])

    expect(judged.findings.map((finding) => finding.id)).toEqual(['reuse-audit-helper'])
    expect(judged.setAside[0]).toMatchObject({ line: 3, raisedBy: ['unclebob'] })
    expect(judged.setAside[0]?.reason).toMatch(/^Its location could not be checked: src\/deep/)
    expect(() => judgeAdviceSchema.parse(judged)).not.toThrow()
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
