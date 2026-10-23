import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { anchorLabel, type Anchor } from '../../../shared/domain/anchors'
import { snapshotMatches } from '../../../shared/domain/findings'
import {
  findingTagLabels,
  panelCommentBody,
  panelCommentId,
  panelCommentsInline,
  panelDraftComment,
  panelSeverityLabels,
  panelVerdictLabels,
  type JudgedFinding,
  type PanelReviewer,
} from '../../../shared/domain/panel'
import type { PanelResult } from '../../../shared/domain/panelSession'
import { panelFindingMarkdown, panelReviewMarkdown } from '../../../shared/domain/panelMarkdown'
import type { ReviewLocation } from '../../../shared/domain/review'
import type { Teammate } from '../../../shared/domain/teammates'
import type { PullRequest, ReviewDraft } from '../../../shared/domain/types'
import { CopyButton } from '../../components/CopyButton'
import {
  FindingComment,
  FindingSummaryEntry,
  removeDraftComment,
  saveDraftComment,
} from '../../components/FindingComment'
import { FindingText } from '../../components/FindingText'
import { GroundingSummary, GroundingVerdict } from './GroundingNotes'
import { PanelFaces, reviewerName } from './PanelFaces'

export interface PanelDraftContext {
  pull: PullRequest
  draft: ReviewDraft
  setDraft: (action: (previous: ReviewDraft) => ReviewDraft) => void
  ready: boolean
  openReview: () => void
  focusLine: (location: ReviewLocation | undefined) => void
}

interface TourProps {
  result: PanelResult
  reviewers: PanelReviewer[]
  teammates?: Teammate[]
  index: number
  advance: (index: number) => void
  context: PanelDraftContext
}

/** The grounded review: a summary, then one step per finding, each a possible draft comment. */
export function PanelTour(props: TourProps) {
  const { result, index, advance, context } = props
  const finding = result.advice.findings[index - 1]
  const stale = !snapshotMatches(context.pull, result.pull)
  const count = result.advice.findings.length + 1
  return (
    <div className="finding-tour">
      <div className="linus-turn-meta">
        <span>PR #{result.pull.number}</span>
        <span>
          {index + 1} / {count}
        </span>
      </div>
      <div className="finding-tour-content" aria-live="polite">
        {finding ? <FindingStep {...props} finding={finding} /> : <SummaryStep {...props} />}
      </div>
      {finding ? (
        <FindingDraftAction result={result} finding={finding} stale={stale} context={context} />
      ) : (
        <div className="finding-actions" key={result.fingerprint}>
          <CopyButton
            label="Copy review"
            text={panelReviewMarkdown(result.advice, props.reviewers)}
          />
        </div>
      )}
      <TourControls index={index} count={count} advance={advance} />
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

/** An inline comment when the finding sits on a line of this PR, else a passage of the summary. */
function FindingDraftAction({
  result,
  finding,
  stale,
  context,
}: {
  result: PanelResult
  finding: JudgedFinding
  stale: boolean
  context: PanelDraftContext
}) {
  const key = `${result.fingerprint}:${finding.id}`
  const entry = {
    location: anchorLabel(finding.anchor),
    initialBody: panelCommentBody(finding),
    disabled: stale || !context.ready,
    actions: <CopyButton label="Copy" text={panelFindingMarkdown(finding)} />,
  }
  const id = panelCommentId(result.pull, finding)
  if (!panelCommentsInline(result.pull, finding))
    return (
      <FindingSummaryEntry
        key={key}
        {...entry}
        entryId={id}
        initialBody={`**${anchorLabel(finding.anchor)}**\n\n${entry.initialBody}`}
        draft={context.draft}
        setDraft={context.setDraft}
      />
    )
  return (
    <FindingComment
      key={key}
      {...entry}
      commentId={id}
      toComment={(body) => panelDraftComment(result.pull, finding, body)}
      comments={context.draft.comments}
      onSave={(comment) => {
        context.setDraft((draft) => saveDraftComment(draft, comment))
      }}
      onDelete={(commentId) => {
        context.setDraft((draft) => removeDraftComment(draft, commentId))
      }}
    />
  )
}

function FindingStep({
  finding,
  result,
  reviewers,
  teammates,
}: TourProps & { finding: JudgedFinding }) {
  const question = finding.tag === 'decision'
  return (
    <>
      <span className="finding-severity">
        {panelSeverityLabels[finding.severity]} · {findingTagLabels[finding.tag]}
      </span>
      <h2 className="finding-title">{finding.title}</h2>
      <p className="finding-location">
        <AnchorText anchor={finding.anchor} />
      </p>
      <PanelFaces ids={finding.raisedBy} reviewers={reviewers} teammates={teammates} />
      <FindingText>{finding.body}</FindingText>
      <GroundingVerdict result={result} id={finding.id} />
      {question ? (
        <p className="panel-question">
          This is a question for the author: the answer depends on intent the code cannot show.
        </p>
      ) : (
        finding.suggestion && (
          <div className="finding-suggestion">
            <h3>Suggested change</h3>
            <FindingText>{finding.suggestion}</FindingText>
          </div>
        )
      )}
    </>
  )
}

/** `src/a.ts:12 · updated code`, with the file and line set as code. */
function AnchorText({ anchor }: { anchor: Anchor }) {
  const [where, ...rest] = anchorLabel(anchor).split(' · ')
  if (anchor.kind === 'description') return <>{where}</>
  return (
    <>
      <code>{where}</code>
      {rest.map((part) => ` · ${part}`).join('')}
    </>
  )
}

function SummaryStep({ result, reviewers, teammates }: TourProps) {
  const { advice } = result
  const notes = [
    ['What reads well', advice.good],
    ['Review limitations', advice.limitations],
    ['Unresolved disagreements', advice.disagreements],
  ] as const
  return (
    <>
      <h2 className="finding-title">{panelVerdictLabels[advice.verdict]}</h2>
      <PanelFaces
        ids={reviewers.map((reviewer) => reviewer.id)}
        reviewers={reviewers}
        teammates={teammates}
      />
      <FindingText>{advice.summary}</FindingText>
      {result.grounding && <GroundingSummary grounding={result.grounding} reviewers={reviewers} />}
      {advice.setAside.length > 0 && (
        <details className="finding-notes">
          <summary>
            {result.grounding ? 'Rejected by both models' : 'Set aside by the judge'} ·{' '}
            {advice.setAside.length}
          </summary>
          <ul>
            {advice.setAside.map((item, index) => (
              <li key={index}>
                <strong>{item.title}</strong>
                {item.path && (
                  <code className="panel-set-aside-path">
                    {item.path}
                    {item.line ? `:${String(item.line)}` : ''}
                  </code>
                )}{' '}
                <span className="muted">
                  · {item.raisedBy.map((id) => reviewerName(reviewers, id)).join(', ')}
                </span>
                <FindingText>{item.body}</FindingText>
                <p className="panel-set-aside-reason">Set aside: {item.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <UnplacedFindings result={result} reviewers={reviewers} />
      {notes
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

/** Findings a reviewer anchored somewhere the snapshot does not contain, kept as written. */
function UnplacedFindings({
  result,
  reviewers,
}: {
  result: PanelResult
  reviewers: PanelReviewer[]
}) {
  const unplaced = result.reviews.flatMap((review) =>
    (review.unplaced ?? []).map((item) => ({ ...item, reviewer: review.reviewer })),
  )
  if (!unplaced.length) return null
  return (
    <details className="finding-notes">
      <summary>Not placed in this snapshot · {unplaced.length}</summary>
      <ul>
        {unplaced.map(({ finding, problem, reviewer }) => (
          <li key={`${reviewer}:${finding.id}`}>
            <strong>{finding.title}</strong>{' '}
            <span className="muted">· {reviewerName(reviewers, reviewer)}</span>
            <FindingText>{finding.body}</FindingText>
            <p className="panel-set-aside-reason">{problem}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}

function TourControls({
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
