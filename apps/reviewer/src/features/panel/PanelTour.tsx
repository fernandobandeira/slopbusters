import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { snapshotMatches } from '../../../shared/domain/findings'
import {
  findingTagLabels,
  panelCommentBody,
  panelCommentId,
  panelDraftComment,
  panelSeverityLabels,
  panelVerdictLabels,
  type JudgedFinding,
  type PanelResult,
  type PanelReviewer,
} from '../../../shared/domain/panel'
import { panelFindingMarkdown, panelReviewMarkdown } from '../../../shared/domain/panelMarkdown'
import type { ReviewLocation } from '../../../shared/domain/review'
import type { Teammate } from '../../../shared/domain/teammates'
import { DiffSide, type PullRequest, type ReviewDraft } from '../../../shared/domain/types'
import { CopyButton } from '../../components/CopyButton'
import {
  FindingComment,
  removeDraftComment,
  saveDraftComment,
} from '../../components/FindingComment'
import { FindingText } from '../../components/FindingText'
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

/** The judged review: a summary, then one step per finding, each a possible draft comment. */
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
        {stale && (
          <p className="linus-notice">
            This PR changed after the panel reviewed it. Ask the panel again before adding comments.
          </p>
        )}
      </div>
      {finding ? (
        <FindingComment
          key={`${result.fingerprint}:${finding.id}`}
          commentId={panelCommentId(result.pull, finding)}
          location={`${finding.path}:${String(finding.line)} (${finding.side})`}
          initialBody={panelCommentBody(finding)}
          toComment={(body) => panelDraftComment(result.pull, finding, body)}
          comments={context.draft.comments}
          disabled={stale || !context.ready}
          actions={<CopyButton label="Copy" text={panelFindingMarkdown(finding)} />}
          onSave={(comment) => {
            context.setDraft((draft) => saveDraftComment(draft, comment))
          }}
          onDelete={(id) => {
            context.setDraft((draft) => removeDraftComment(draft, id))
          }}
        />
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

function FindingStep({ finding, reviewers, teammates }: TourProps & { finding: JudgedFinding }) {
  const question = finding.tag === 'decision'
  return (
    <>
      <span className="finding-severity">
        {panelSeverityLabels[finding.severity]} · {findingTagLabels[finding.tag]}
      </span>
      <h2 className="finding-title">{finding.title}</h2>
      <p className="finding-location">
        <code>
          {finding.path}:{finding.line}
        </code>{' '}
        · {finding.side === DiffSide.left ? 'original' : 'updated'} code
      </p>
      <PanelFaces ids={finding.raisedBy} reviewers={reviewers} teammates={teammates} />
      <FindingText>{finding.body}</FindingText>
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
      {advice.setAside.length > 0 && (
        <details className="finding-notes">
          <summary>Set aside by the judge · {advice.setAside.length}</summary>
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
