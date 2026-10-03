import { describe, expect, it } from 'vitest'
import { clearSubmittedFeedback } from '../shared/review'
import { DiffSide, type ReviewDraft } from '../shared/types'

describe('feedback edited during review submission', () => {
  it('clears published feedback while preserving new comments, edited comments, and summary edits', () => {
    const comment = {
      id: 'first',
      body: 'Original feedback',
      headSha: 'head',
      path: 'app.ts',
      line: 3,
      side: DiffSide.right,
    }
    const submitted: ReviewDraft = {
      comments: [comment, { ...comment, id: 'published' }],
      summary: 'Original summary',
      viewedFileIds: ['viewed'],
    }
    const current = {
      ...submitted,
      comments: [
        { ...comment, body: 'Edited feedback' },
        submitted.comments[1]!,
        { ...comment, id: 'new', body: 'New feedback' },
      ],
      summary: 'Updated summary',
    }
    expect(clearSubmittedFeedback(current, submitted)).toEqual({
      ...current,
      comments: [current.comments[0], current.comments[2]],
    })
    expect(clearSubmittedFeedback(submitted, submitted)).toEqual({
      ...submitted,
      comments: [],
      summary: '',
    })
  })
})
