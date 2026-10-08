import { useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  jobsExpression,
  jobsSnapshotMatches,
  jobsVerdictLabels,
  latestJobsAdvice,
  type JobsRevision,
  type JobsSession,
} from '../../../shared/domain/jobs'
import type { Ticket } from '../../../shared/domain/tickets'
import { TicketMarkdown } from '../../components/TicketMarkdown'
import { JobsFindings } from './JobsFindings'
import { JobsProposal } from './JobsProposal'
import { JobsQuestions } from './JobsQuestions'
import { useJobsSession } from './useJobsSession'
import '../../linus.css'
import './jobs.css'

type Tab = 'questions' | 'findings' | 'proposal'

export function JobsPanel({
  ticket,
  repository,
  onApplied,
  renderSessionCard,
}: {
  ticket: Ticket
  repository: string
  onApplied: () => void
  renderSessionCard: (session: JobsSession) => ReactNode
}) {
  const job = useJobsSession(ticket.identifier, repository)
  const { session } = job
  const revision = latestJobsAdvice(session)
  const working = session?.status === 'running' || session?.status === 'partial'
  return (
    <section className="jobs-panel" aria-label="Steve Jobs ticket review">
      <header className="jobs-header">
        <img
          className="jobs-portrait"
          src={`/jobs/${jobsExpression(session)}.svg`}
          alt={`Steve Jobs, ${jobsExpression(session)}`}
        />
        <div>
          <span className="linus-eyebrow">STEVE JOBS · TICKET REVIEW</span>
          <p className="jobs-speech">{speech(session, revision)}</p>
        </div>
      </header>
      {session && renderSessionCard(session)}
      <JobsControls job={job} repository={repository} hasReview={Boolean(revision)} />
      {working && (
        <p role="status" className="jobs-progress">
          <LoaderCircle className="animate-spin" size={14} /> {session.progress}
        </p>
      )}
      {session?.applied && (
        <p role="status" className="jobs-applied">
          Applied to Linear on {new Date(session.applied.at).toLocaleString()}. Review again to keep
          iterating.
        </p>
      )}
      {revision && session && (
        <JobsResult
          key={revision.createdAt}
          session={session}
          revision={revision}
          ticket={ticket}
          busy={job.busy || working}
          onFold={(answers) => void job.answer(answers)}
          onApply={(changes) => void job.apply(changes).then(onApplied)}
        />
      )}
      {job.error && (
        <p className="linus-error" role="alert">
          {job.error}
        </p>
      )}
    </section>
  )
}

function speech(session: JobsSession | undefined, revision: JobsRevision | undefined) {
  if (!session || !revision)
    return 'What job is this ticket doing, and could someone who wasn’t there build it today?'
  if (session.status === 'running') return 'Reading. Give me a minute.'
  const open = revision.advice.questions.length
  return `${jobsVerdictLabels[revision.advice.verdict]}.${open ? ` ${String(open)} question${open === 1 ? '' : 's'} only you can answer.` : ''}`
}

function JobsControls({
  job,
  repository,
  hasReview,
}: {
  job: ReturnType<typeof useJobsSession>
  repository: string
  hasReview: boolean
}) {
  const { session, busy, loading, act } = job
  const status = session?.status
  return (
    <div className="jobs-actions">
      {status === 'running' || status === 'partial' ? (
        <>
          {status === 'partial' && (
            <Button size="sm" disabled={busy} onClick={() => void act('continue')}>
              Continue with one review
            </Button>
          )}
          {status === 'partial' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('retry')}>
              Retry both
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" disabled={busy || loading} onClick={() => void act('start')}>
            {hasReview ? 'Review again' : 'Review this ticket'}
          </Button>
          {(status === 'failed' || status === 'cancelled') && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void act('retry')}>
              Retry
            </Button>
          )}
        </>
      )}
      <span className="muted jobs-repository">
        {repository ? `Checks code in ${repository}` : 'No repository selected for code checks'}
      </span>
      {session?.status === 'failed' && session.error && (
        <p className="linus-error" role="alert">
          {session.error}
        </p>
      )}
    </div>
  )
}

function JobsResult({
  session,
  revision,
  ticket,
  busy,
  onFold,
  onApply,
}: {
  session: JobsSession
  revision: JobsRevision
  ticket: Ticket
  busy: boolean
  onFold: Parameters<typeof JobsQuestions>[0]['onFold']
  onApply: Parameters<typeof JobsProposal>[0]['onApply']
}) {
  const { advice } = revision
  const [tab, setTab] = useState<Tab>(advice.questions.length ? 'questions' : 'proposal')
  const stale = !session.applied && !jobsSnapshotMatches(session, ticket)
  const tabs: [Tab, string][] = [
    ['questions', `Questions (${String(advice.questions.length)})`],
    ['findings', `Findings (${String(advice.findings.length)})`],
    ['proposal', 'Proposed ticket'],
  ]
  return (
    <div className="jobs-result">
      <div className="jobs-summary">
        <TicketMarkdown markdown={advice.summary} label="Steve Jobs's summary" />
      </div>
      {revision.kind === 'answers' && (
        <p className="muted">
          Folded {revision.answers.length} answer{revision.answers.length === 1 ? '' : 's'};
          resolved {advice.resolved.length}.
        </p>
      )}
      <div className="jobs-modes" role="tablist" aria-label="Jobs review">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'questions' && (
        <JobsQuestions
          questions={advice.questions}
          disabled={busy || Boolean(session.applied) || stale}
          onFold={onFold}
        />
      )}
      {tab === 'findings' && <JobsFindings advice={advice} />}
      {tab === 'proposal' && (
        <JobsProposal
          ticket={ticket}
          advice={advice}
          stale={stale}
          disabled={busy || Boolean(session.applied)}
          onApply={onApply}
        />
      )}
    </div>
  )
}
