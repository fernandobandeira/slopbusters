import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  bobCommentId,
  bobDraftComment,
  bobFindingMarkdown,
  bobReviewMarkdown,
  bobSeverityLabels,
  bobSnapshotMatches,
  bobVerdictLabels,
  type BobResult,
  type BobFinding,
} from '../../../shared/domain/bob'
import { DiffSide, type PullRequest, type ReviewDraft } from '../../../shared/domain/types'
import type { ReviewLocation } from '../../../shared/domain/review'
import {
  FindingComment,
  removeDraftComment,
  saveDraftComment,
} from '../../components/FindingComment'
import { CopyButton } from '../../components/CopyButton'
import { FindingText } from '../../components/FindingText'

export interface BobDraftContext {
  pull: PullRequest
  draft: ReviewDraft
  setDraft: (action: (previous: ReviewDraft) => ReviewDraft) => void
  ready: boolean
  openReview: () => void
  focusLine: (location: ReviewLocation | undefined) => void
}

export function BobTour({
  result,
  index,
  advance,
  context,
}: {
  result: BobResult
  index: number
  advance: (index: number) => void
  context: BobDraftContext
}) {
  const { advice } = result
  const finding = advice.findings[index - 1]
  const stale = !bobSnapshotMatches(context.pull, result.pull)
  return (
    <div className="finding-tour">
      <div className="linus-turn-meta">
        <span>PR #{result.pull.number}</span>
        <span>
          {index + 1} / {advice.findings.length + 1}
        </span>
      </div>
      <div className="finding-tour-content" aria-live="polite">
        {finding && <span className="finding-severity">{bobSeverityLabels[finding.severity]}</span>}
        <h2 className="finding-title">{finding?.title ?? bobVerdictLabels[advice.verdict]}</h2>
        {finding && (
          <p className="finding-location">
            <code>
              {finding.path}:{finding.line}
            </code>{' '}
            · {finding.side === DiffSide.left ? 'original' : 'updated'} code
          </p>
        )}
        <FindingText>{finding?.body ?? advice.summary}</FindingText>
        {!finding && <BobReviewNotes result={result} />}
        {finding && (
          <div className="finding-suggestion">
            <h3>Suggested improvement</h3>
            <FindingText>{finding.suggestion}</FindingText>
          </div>
        )}
        {stale && (
          <p className="linus-notice">
            This PR changed after Uncle Bob’s review. Review it again before adding comments.
          </p>
        )}
      </div>
      {finding ? (
        <BobDraftAnnotation
          key={`${result.fingerprint}:${finding.id}`}
          result={result}
          finding={finding}
          context={context}
          stale={stale}
        />
      ) : (
        <div className="finding-actions" key={result.fingerprint}>
          <CopyButton label="Copy review" text={bobReviewMarkdown(advice)} />
        </div>
      )}
      <BobTourControls index={index} count={advice.findings.length + 1} advance={advance} />
      {context.draft.comments.length > 0 && (
        <Button
          className="finding-submit"
          size="sm"
          variant="outline"
          disabled={!context.ready}
          onClick={context.openReview}
        >
          Review draft · {context.draft.comments.length}{' '}
          {context.draft.comments.length === 1 ? 'comment' : 'comments'}
        </Button>
      )}
    </div>
  )
}

function BobDraftAnnotation({
  result,
  finding,
  context,
  stale,
}: {
  result: BobResult
  finding: BobFinding
  context: BobDraftContext
  stale: boolean
}) {
  return (
    <FindingComment
      commentId={bobCommentId(result.pull, finding)}
      location={`${finding.path}:${String(finding.line)} (${finding.side})`}
      initialBody={`${finding.title}\n\n${finding.body}\n\n${finding.suggestion}`}
      toComment={(body) => bobDraftComment(result.pull, finding, body)}
      comments={context.draft.comments}
      disabled={stale || !context.ready}
      actions={<CopyButton label="Copy" text={bobFindingMarkdown(finding)} />}
      onSave={(comment) => {
        context.setDraft((draft) => saveDraftComment(draft, comment))
      }}
      onDelete={(id) => {
        context.setDraft((draft) => removeDraftComment(draft, id))
      }}
    />
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
          <details className="finding-notes" key={title}>
            <summary>{title}</summary>
            <ul>
              {entries.map((text, index) => (
                <li key={index}>
                  <FindingText>{text}</FindingText>
                </li>
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
}: {
  index: number
  count: number
  advance: (index: number) => void
}) {
  return (
    <div className="linus-tour-controls finding-tour-controls">
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
