import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  bobSeverityLabels,
  bobSnapshotMatches,
  bobVerdictLabels,
  type BobResult,
} from '../../../shared/domain/bob'
import type { PullRequest, ReviewDraft } from '../../../shared/domain/types'
import { BobComment, saveBobComment } from './BobComment'

export interface BobDraftContext {
  pull: PullRequest
  draft: ReviewDraft
  setDraft: (action: (previous: ReviewDraft) => ReviewDraft) => void
  ready: boolean
  openReview: () => void
}

export function BobTour({
  result,
  index,
  advance,
  context,
  showEvidence,
}: {
  result: BobResult
  index: number
  advance: (index: number) => void
  context: BobDraftContext
  showEvidence: () => void
}) {
  const { advice } = result
  const finding = advice.findings[index - 1]
  const stale = !bobSnapshotMatches(context.pull, result.pull)
  return (
    <>
      <div className="linus-turn-meta">
        <span>PR #{result.pull.number}</span>
        <span>
          {index + 1} / {advice.findings.length + 1}
        </span>
      </div>
      <strong className="linus-verdict">
        {finding
          ? `${bobSeverityLabels[finding.severity]} · ${finding.title}`
          : bobVerdictLabels[advice.verdict]}
      </strong>
      <p className="linus-speech" aria-live="polite">
        {finding?.body ?? advice.summary}
      </p>
      {!finding && <BobReviewNotes result={result} />}
      {stale && (
        <p className="linus-notice">
          This PR changed after Bob’s review. Review it again before adding comments.
        </p>
      )}
      {finding && (
        <BobComment
          key={`${result.fingerprint}:${finding.id}`}
          pull={result.pull}
          finding={finding}
          comments={context.draft.comments}
          disabled={stale || !context.ready}
          onSave={(comment) => {
            context.setDraft((draft) => saveBobComment(draft, comment))
          }}
          onDelete={(id) => {
            context.setDraft((draft) => ({
              ...draft,
              comments: draft.comments.filter((comment) => comment.id !== id),
            }))
          }}
        />
      )}
      <BobTourControls
        index={index}
        count={advice.findings.length + 1}
        advance={advance}
        showEvidence={showEvidence}
      />
      {context.draft.comments.length > 0 && (
        <Button
          className="bob-submit"
          size="sm"
          variant="outline"
          disabled={!context.ready}
          onClick={context.openReview}
        >
          Review draft · {context.draft.comments.length}{' '}
          {context.draft.comments.length === 1 ? 'comment' : 'comments'}
        </Button>
      )}
    </>
  )
}

function BobReviewNotes({ result }: { result: BobResult }) {
  const sections = [
    ['What reads well', result.advice.good],
    ['Review limitations', result.advice.limitations],
    ['Unresolved disagreements', result.advice.disagreements],
  ] as const
  return (
    <>
      {sections
        .filter(([, entries]) => entries.length)
        .map(([title, entries]) => (
          <details className="bob-notes" key={title}>
            <summary>{title}</summary>
            <ul>
              {entries.map((text, index) => (
                <li key={index}>{text}</li>
              ))}
            </ul>
          </details>
        ))}
    </>
  )
}

function BobTourControls({
  index,
  count,
  advance,
  showEvidence,
}: {
  index: number
  count: number
  advance: (index: number) => void
  showEvidence: () => void
}) {
  return (
    <div className="linus-tour-controls">
      {index > 0 && (
        <Button size="sm" variant="ghost" onClick={showEvidence}>
          Show code
        </Button>
      )}
      <div className="linus-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={index === 0}
          onClick={() => {
            advance(index - 1)
          }}
        >
          <ChevronLeft size={14} />
          Back
        </Button>
        <Button
          size="sm"
          disabled={index >= count - 1}
          onClick={() => {
            advance(index + 1)
          }}
        >
          Next
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  )
}
