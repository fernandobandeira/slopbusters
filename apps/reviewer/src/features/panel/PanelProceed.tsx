import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { leadSource } from '../../../shared/domain/grounding'
import { fixCheckLabels, type FixCheck, type FixHandoff } from '../../../shared/domain/panelFix'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { usePanelGate } from './usePanelGate'
import { usePanelProceed } from './usePanelProceed'

/**
 * Proceed: the ready fixes for this PR go to one T3 Code thread in a worktree of the reviewed
 * head. Findings for another layer or the PR's title or description go elsewhere.
 */
export function PanelProceed({
  session,
  result,
  gate,
  replace,
  moved,
  onOpen,
}: {
  session: PanelSession
  result: PanelResult
  gate: ReturnType<typeof usePanelGate>
  replace: (session: PanelSession) => void
  /** The PR has new commits since the review, so its plans may not apply. */
  moved: boolean
  onOpen: (sessionId: string) => void
}) {
  const proceed = usePanelProceed(session, result, gate.gate, replace)
  const { handoff } = result
  if (handoff?.state === 'sent' && handoff.launch)
    return (
      <div className="linus-notice panel-proceed" role="status">
        <SentNotice handoff={handoff} />
        {handoff.check && <FixCheckResults result={result} check={handoff.check} />}
        <div className="linus-actions">
          <Button
            size="sm"
            disabled={proceed.sending}
            onClick={() => {
              proceed.reviewLocal(onOpen)
            }}
          >
            {proceed.sending && (
              <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />
            )}
            Review local fixes
          </Button>
          <Button size="sm" variant="outline" disabled={proceed.sending} onClick={proceed.check}>
            {handoff.check ? 'Check local fixes again' : 'Check local fixes'}
          </Button>
        </div>
        <p className="muted">
          Once the thread has committed its fixes, the panel can review them on the fix branch, or
          the other provider’s model can check that each plan was applied. Nothing needs to be
          pushed.
        </p>
        {proceed.error && <p role="alert">{proceed.error}</p>}
      </div>
    )
  const fixes = gate.ready.filter((item) => item.route?.kind === 'fix').length
  return (
    <div className="panel-proceed">
      <HandoffProblem handoff={handoff} sending={proceed.sending} />
      {moved && (
        <p className="muted">The PR has new commits since this review; review it again first.</p>
      )}
      <Button size="sm" disabled={!fixes || moved || proceed.sending} onClick={proceed.proceed}>
        {proceed.sending && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
        {proceed.sending ? 'Sending…' : proceedLabel(fixes)}
      </Button>
      {proceed.error && <p role="alert">{proceed.error}</p>}
    </div>
  )
}

function SentNotice({ handoff }: { handoff: FixHandoff }) {
  const launch = handoff.launch
  if (!launch) return null
  const count = handoff.entries.length
  return (
    <>
      <p>
        <strong>
          Sent {count} {count === 1 ? 'fix' : 'fixes'} to “{launch.title}”
        </strong>{' '}
        in {launch.location === 't3code' ? 'T3 Code' : 'the Slopbusters chat window'}. It works on{' '}
        <code>{launch.branch}</code>, from the reviewed commit{' '}
        <code>{launch.reviewedSha.slice(0, 7)}</code>, commits what passes verification, and never
        pushes.
      </p>
    </>
  )
}

/** The other provider's verdict on each sent fix, at the commit it read. */
function FixCheckResults({ result, check }: { result: PanelResult; check: FixCheck }) {
  const entries = result.grounding?.resolved ?? []
  const candidates = result.grounding?.candidates ?? []
  return (
    <div className="panel-fix-check">
      <p>
        <strong>Checked by {check.model.model}</strong> at <code>{check.sha.slice(0, 7)}</code>:{' '}
        {check.summary}
      </p>
      <ul>
        {check.results.map((item) => {
          const entry = entries.find((candidate) => candidate.id === item.entry)
          const title = entry ? leadSource(entry, candidates)?.finding.title : undefined
          return (
            <li key={item.entry}>
              <strong>{fixCheckLabels[item.status]}</strong> · {title ?? item.entry}: {item.note}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function HandoffProblem({ handoff, sending }: { handoff?: FixHandoff; sending: boolean }) {
  if (sending || !handoff) return null
  if (handoff.state === 'failed')
    return (
      <p className="panel-gate-problem" role="status">
        The last send failed: {handoff.error ?? 'unknown error'}
      </p>
    )
  if (handoff.state === 'preparing')
    return (
      <p className="panel-gate-problem" role="status">
        A send started and did not finish. Sending again reuses the same thread.
      </p>
    )
  return null
}

function proceedLabel(fixes: number) {
  if (!fixes) return 'Choose a fix to send'
  return `Send ${String(fixes)} ${fixes === 1 ? 'fix' : 'fixes'} to a fix thread`
}
