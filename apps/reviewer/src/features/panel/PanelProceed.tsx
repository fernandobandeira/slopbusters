import { LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import type { FixHandoff } from '../../../shared/domain/panelFix'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import type { usePanelGate } from './usePanelGate'
import { usePanelProceed } from './usePanelProceed'

/**
 * Proceed: the ready fixes for this PR go to one T3 Code thread in a worktree of the reviewed
 * head. Fixes for another layer or the PR's title or description are counted but not sent yet.
 */
export function PanelProceed({
  session,
  result,
  gate,
  replace,
  moved,
}: {
  session: PanelSession
  result: PanelResult
  gate: ReturnType<typeof usePanelGate>
  replace: (session: PanelSession) => void
  /** The PR has new commits since the review, so its plans may not apply. */
  moved: boolean
}) {
  const proceed = usePanelProceed(session, result, gate.gate, replace)
  const { handoff } = result
  if (handoff?.state === 'sent' && handoff.launch) return <SentNotice handoff={handoff} />
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
      <Elsewhere count={gate.ready.length - fixes} />
      {proceed.error && <p role="alert">{proceed.error}</p>}
    </div>
  )
}

function SentNotice({ handoff }: { handoff: FixHandoff }) {
  const launch = handoff.launch
  if (!launch) return null
  const count = handoff.entries.length
  return (
    <div className="linus-notice panel-proceed" role="status">
      <p>
        <strong>
          Sent {count} {count === 1 ? 'fix' : 'fixes'} to “{launch.title}”
        </strong>{' '}
        in {launch.location === 't3code' ? 'T3 Code' : 'the Slopbusters chat window'}. It works on{' '}
        <code>{launch.branch}</code>, from the reviewed commit{' '}
        <code>{launch.reviewedSha.slice(0, 7)}</code>, commits what passes verification, and never
        pushes.
      </p>
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

function Elsewhere({ count }: { count: number }) {
  if (!count) return null
  return (
    <p className="muted">
      {count} ready {count === 1 ? 'change belongs' : 'changes belong'} on another layer or the PR
      description and {count === 1 ? 'is' : 'are'} not sent yet.
    </p>
  )
}

function proceedLabel(fixes: number) {
  if (!fixes) return 'Choose a fix to send'
  return `Send ${String(fixes)} ${fixes === 1 ? 'fix' : 'fixes'} to a fix thread`
}
