import { describe, expect, it } from 'vitest'
import { bobDraftComment, bobSnapshotMatches, validateBobAdvice } from '../shared/domain/bob'
import { draftSchema } from '../shared/api/reviewSchemas'
import { buildGitHubReview } from '../shared/domain/review'
import { DiffSide, LineKind, ReviewEvent } from '../shared/domain/types'
import { fixtureBobAdvice, fixtureBobFinding, required } from './fixtures/bob'
import { fixturePull } from './fixtures/pull'

describe('Bob findings and review comments', () => {
  it('requires a real changed line on the correct side of the cited hunk', () => {
    const pull = fixturePull()
    const advice = fixtureBobAdvice()
    expect(validateBobAdvice(pull, advice)).toEqual(advice)

    for (const change of [
      { path: 'invented.ts' },
      { hunkId: 'other-hunk' },
      { line: 900 },
      { side: DiffSide.left },
    ])
      expect(() =>
        validateBobAdvice(pull, { ...advice, findings: [{ ...advice.findings[0], ...change }] }),
      ).toThrow(/changed line/)
    const file = required(pull.files[1])
    const hunk = required(file.hunks[0])
    const line = required(hunk.lines.find((line) => line.kind === LineKind.context))
    expect(() =>
      validateBobAdvice(pull, {
        ...advice,
        findings: [{ ...advice.findings[0], hunkId: hunk.id, line: line.newLine }],
      }),
    ).toThrow(/changed line/)
  })
  it('rejects conflicting verdicts and duplicate findings', () => {
    const advice = fixtureBobAdvice()
    expect(() => validateBobAdvice(fixturePull(), { ...advice, verdict: 'clean' })).toThrow(/clean/)
    expect(() => validateBobAdvice(fixturePull(), { ...advice, findings: [] })).toThrow(/finding/)
    expect(() =>
      validateBobAdvice(fixturePull(), {
        ...advice,
        findings: [advice.findings[0], advice.findings[0]],
      }),
    ).toThrow(/unique/)
  })
  it('builds a user-edited inline comment that the existing GitHub review submits at the saved head', () => {
    const pull = fixturePull()
    const comment = bobDraftComment(
      pull,
      fixtureBobFinding(),
      '  Please reuse auditProjectUpdate here.  ',
    )
    const payload = buildGitHubReview(
      pull,
      { comments: [comment], summary: '', viewedFileIds: [] },
      ReviewEvent.requestChanges,
    )

    expect(
      draftSchema.parse({ comments: [comment], summary: '', viewedFileIds: [] }).comments,
    ).toEqual([comment])
    expect(payload.commit_id).toBe(pull.headSha)
    expect(payload.comments).toEqual([
      {
        path: comment.path,
        line: comment.line,
        side: DiffSide.right,
        body: 'Please reuse auditProjectUpdate here.',
      },
    ])
  })
  it('requires a fresh review when the head, base, title or description changes', () => {
    const pull = fixturePull()
    expect(bobSnapshotMatches({ ...pull, groups: [] }, pull)).toBe(true)
    for (const change of [
      { headSha: 'new' },
      { baseSha: 'new' },
      { title: 'new' },
      { description: 'new' },
    ])
      expect(bobSnapshotMatches({ ...pull, ...change }, pull)).toBe(false)
  })
})
