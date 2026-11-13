import { describe, expect, it } from 'vitest'
import type { GroundingCandidate, ResolvedEntry } from '../../../shared/domain/grounding'
import {
  panelBriefMarkdown,
  panelFindingBrief,
  panelFindingPlan,
} from '../../../shared/domain/panelBrief'
import type { PanelReviewer } from '../../../shared/domain/panel'
import type { PanelResult } from '../../../shared/domain/panelSession'
import { Provider } from '../../../shared/domain/types'
import { fixtureJudgeAdvice, fixturePanelFinding } from '../../fixtures/panel'
import { fixturePull } from '../../fixtures/pull'

const pull = fixturePull()
const reviewers: PanelReviewer[] = [{ id: 'unclebob', name: 'Uncle Bob', maxFindings: 5 }]

function candidate(key: string, title: string): GroundingCandidate {
  return {
    key,
    pull: pull.number,
    seat: 'unclebob',
    rank: Number(key.slice(1)) - 1,
    finding: fixturePanelFinding({ id: `finding-${key}`, title, body: `${title} body.` }),
    state: 'selected',
  }
}

function entry(id: string, source: string, changes: Partial<ResolvedEntry> = {}): ResolvedEntry {
  return {
    id,
    sources: [source],
    verdict: 'legit',
    reason: `Reason for ${id}.`,
    evidence: ['src/audit.ts:4'],
    plan: `Plan for ${id}.`,
    origin: 'change',
    destination: { kind: 'code', pull: pull.number },
    resolution: 'agreed',
    raisedBy: ['unclebob'],
    ...changes,
  }
}

function result(resolved: ResolvedEntry[], changes: Partial<PanelResult> = {}): PanelResult {
  return {
    pull,
    fingerprint: 'fp',
    advice: fixtureJudgeAdvice(),
    reviews: [],
    grounding: {
      budget: 10,
      candidates: [
        candidate('f1', 'Reuse the audit helper'),
        candidate('f2', 'Rename the guard'),
        candidate('f3', 'Who may edit archived projects?'),
      ],
      roles: { primary: { provider: Provider.codex, model: 'gpt' } },
      turns: [],
      entries: resolved,
      positions: {},
      outcome: 'agreed',
      resolved,
    },
    ...changes,
  }
}

describe('the panel review copied for an agent', () => {
  it('leads with the reviewed revision and the chosen fixes with their plans and evidence', () => {
    const brief = panelBriefMarkdown(result([entry('g1', 'f1')]), reviewers)

    expect(brief).toContain(pull.url)
    expect(brief).toContain(`Reviewed head \`${pull.headSha}\``)
    expect(brief).toContain('## The fixes the author chose')
    expect(brief).toContain('### 1. Reuse the audit helper')
    expect(brief).toContain('Plan: Plan for g1.')
    expect(brief).toContain('Why: Reason for g1.')
    expect(brief).toContain('Evidence: src/audit.ts:4')
    expect(brief).toContain('Apply only the plans below.')
  })

  it('keeps unchosen findings as context and tells the agent not to act on them', () => {
    const brief = panelBriefMarkdown(
      result([
        entry('g1', 'f1'),
        entry('g2', 'f2', { origin: 'preexisting' }),
        entry('g3', 'f3', { verdict: 'authorsCall', plan: undefined, question: 'Per day?' }),
      ]),
      reviewers,
    )

    const context = brief.slice(brief.indexOf('## Other grounded findings'))
    expect(context).toContain('do not fix them unless asked')
    expect(context).toContain('**Rename the guard**')
    expect(brief).toContain('## Needs your decision')
    expect(brief).toContain('Question for the author: Per day?')
    expect(brief.indexOf('### 1. Reuse the audit helper')).toBeLessThan(brief.indexOf(context))
  })

  it('uses the author’s plan and answer over the grounded plan', () => {
    const brief = panelBriefMarkdown(
      result(
        [entry('g3', 'f3', { verdict: 'authorsCall', plan: undefined, question: 'Per day?' })],
        {
          gate: {
            actions: [
              {
                entry: 'g3',
                selected: true,
                answer: 'Yes, per day.',
                plan: 'Count per calendar day.',
                planBy: 'author',
              },
            ],
          },
        },
      ),
      reviewers,
    )

    expect(brief).toContain('Plan: Count per calendar day.')
    expect(brief).toContain('The author\'s answer to "Per day?": Yes, per day.')
  })

  it('lists rejections so the agent does not reintroduce them, and says when nothing is chosen', () => {
    const advice = fixtureJudgeAdvice()
    advice.setAside.push({
      title: 'Extract a class',
      body: 'Wrap it.',
      raisedBy: ['unclebob'],
      reason: 'Over-engineering: one caller.',
    })
    const brief = panelBriefMarkdown(
      result([entry('g1', 'f1', { verdict: 'notTrue', plan: undefined })], { advice }),
      reviewers,
    )

    expect(brief).toContain('None yet.')
    expect(brief).toContain('- **Extract a class**: Over-engineering: one caller.')
    expect(brief).not.toContain('## Other grounded findings')
  })

  it('falls back to the judged review, with the revision, for sessions before grounding', () => {
    const brief = panelBriefMarkdown(result([], { grounding: undefined }), reviewers)

    expect(brief).toContain(`Reviewed head \`${pull.headSha}\``)
    expect(brief).toContain('## Review panel: ')
  })
})

describe('one finding copied for an agent', () => {
  it('adds what grounding and the author decided about it', () => {
    const finding = { ...fixturePanelFinding(), id: 'g1', raisedBy: ['unclebob'] }
    const disputed = entry('g1', 'f1', {
      resolution: 'disputed',
      other: {
        role: 'secondary',
        entries: [entry('x', 'f1', { verdict: 'tasteSkip', reason: 'Style only.' })],
        objections: ['The helper logs twice.'],
      },
    })
    const copied = result([disputed], {
      gate: { actions: [{ entry: 'g1', selected: true, choice: 'list' }] },
    })

    const brief = panelFindingBrief(copied, finding)

    expect(brief).toContain(pull.url)
    expect(brief).toContain('**Grounding:** Worth fixing · The models disagree')
    expect(brief).toContain('Plan: Plan for g1.')
    expect(brief).toContain('The other model held: Taste, safe to skip: Style only.')
    expect(brief).toContain('objected: The helper logs twice.')
    expect(brief).toContain('The author chose to fix this.')
    expect(panelFindingPlan(copied, finding)).toBe('Plan for g1.')
  })

  it('is the reviewer’s finding alone when grounding has no entry for it', () => {
    const finding = { ...fixturePanelFinding(), id: 'missing', raisedBy: ['unclebob'] }

    expect(panelFindingBrief(result([]), finding)).not.toContain('Grounding')
    expect(panelFindingPlan(result([]), finding)).toBeUndefined()
  })
})

describe('triage in the agent brief', () => {
  it('ranks fixes and gives decisions a recommendation and cost', () => {
    const brief = panelBriefMarkdown(
      result([
        entry('g1', 'f1', { kind: 'test', effort: 'medium' }),
        entry('g2', 'f2', { kind: 'simplification', effort: 'small' }),
        entry('g3', 'f3', {
          verdict: 'authorsCall',
          kind: 'product',
          effort: 'large',
          question: 'Keep it?',
        }),
      ]),
      reviewers,
    )
    expect(brief).toContain('### 1. Rename the guard')
    expect(brief).toContain('### 2. Reuse the audit helper')
    expect(brief).toContain('Kind: Simplification. Effort: small.')
    expect(brief).toContain('Do not act on these until the author answers.')
    expect(brief).toContain('Recommendation: Plan for g3.')
    expect(brief).toContain('Cost: large.')
  })
})
