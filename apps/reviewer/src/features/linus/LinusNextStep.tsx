import { useId, useState } from 'react'
import { Button } from '~/components/ui/button'
import {
  panelProceeds,
  verdictLabels,
  type LinusResult,
  type LinusThenPanel,
} from '../../../shared/domain/linus'

interface DecisionProps {
  result: LinusResult
  thenPanel: LinusThenPanel
  busy: boolean
  onOpenPanel: (sessionId: string) => void
  onSendOn: () => void
  onAskAgain: (guidance: string) => void
  /** Build the stack Linus proposed; absent where splitting is not offered. */
  onSplit?: () => void
}

/**
 * What comes after Linus's review of this PR: the split he is building from his layers, the
 * panel that was to follow him, or the offer to split a PR he would cut.
 */
export function LinusNextStep({
  result,
  thenPanel,
  busy,
  onOpenPanel,
  onOpenSplit,
  onSendOn,
  onAskAgain,
  onSplit,
}: Omit<DecisionProps, 'thenPanel'> & {
  thenPanel?: LinusThenPanel
  onOpenSplit: (sessionId: string) => void
}) {
  if (result.splitSessionId) {
    const sessionId = result.splitSessionId
    return (
      <div className="linus-notice linus-panel-decision" role="status">
        <p>Linus is splitting PR #{String(result.pull.number)} into a stack from these layers.</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onOpenSplit(sessionId)
          }}
        >
          Open the split
        </Button>
      </div>
    )
  }
  if (thenPanel)
    return (
      <LinusPanelDecision
        result={result}
        thenPanel={thenPanel}
        busy={busy}
        onOpenPanel={onOpenPanel}
        onSendOn={onSendOn}
        onAskAgain={onAskAgain}
        onSplit={onSplit}
      />
    )
  if (!onSplit || panelProceeds(result.advice) || result.advice.verdict === 'uncertain') return null
  return (
    <div className="linus-actions linus-split-offer">
      <Button size="sm" variant="outline" disabled={busy} onClick={onSplit}>
        Split this PR
      </Button>
    </div>
  )
}

/**
 * What the panel that was to follow Linus is doing on this PR: reviewing it, or waiting for the
 * author to split the PR, send it on as one, or ask Linus again with more to go on.
 */
function LinusPanelDecision(props: DecisionProps) {
  const { result, busy, onOpenPanel, onSendOn } = props
  const number = String(result.pull.number)
  if (result.panelSessionId) {
    const sessionId = result.panelSessionId
    return (
      <div className="linus-notice linus-panel-decision" role="status">
        <p>
          The panel is reviewing PR #{number}
          {panelProceeds(result.advice) ? '' : ' as one PR'}.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onOpenPanel(sessionId)
          }}
        >
          Open the panel
        </Button>
      </div>
    )
  }
  if (panelProceeds(result.advice))
    return (
      <div className="linus-notice linus-panel-decision">
        <p>The panel did not start{result.panelError ? `: ${result.panelError}` : '.'}</p>
        <Button size="sm" disabled={busy} onClick={onSendOn}>
          Start the panel
        </Button>
      </div>
    )
  return <WaitingDecision {...props} />
}

/** Linus would split the PR: the author splits it, sends it on as one, or tells Linus more. */
function WaitingDecision({
  result,
  thenPanel,
  busy,
  onSendOn,
  onAskAgain,
  onSplit,
}: DecisionProps) {
  const [asking, setAsking] = useState(false)
  const count = String(thenPanel.reviewers.length)
  return (
    <div className="linus-notice linus-panel-decision">
      <p>
        <strong>The panel is waiting on you.</strong> Linus says{' '}
        {verdictLabels[result.advice.verdict].toLowerCase()}, so the {count}{' '}
        {thenPanel.reviewers.length === 1 ? 'reviewer has' : 'reviewers have'} not started.
        {result.panelError ? ` ${result.panelError}` : ''}
      </p>
      {asking ? (
        <GuidanceForm
          busy={busy}
          onSubmit={(guidance) => {
            onAskAgain(guidance)
            setAsking(false)
          }}
          onCancel={() => {
            setAsking(false)
          }}
        />
      ) : (
        <div className="linus-actions">
          {onSplit && (
            <Button size="sm" disabled={busy} onClick={onSplit}>
              Split this PR
            </Button>
          )}
          <Button
            size="sm"
            variant={onSplit ? 'outline' : 'default'}
            disabled={busy}
            onClick={onSendOn}
          >
            Review as one PR
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setAsking(true)
            }}
          >
            Tell Linus more
          </Button>
        </div>
      )}
    </div>
  )
}

function GuidanceForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean
  onSubmit: (guidance: string) => void
  onCancel: () => void
}) {
  const [guidance, setGuidance] = useState('')
  const id = useId()
  return (
    <form
      className="linus-guidance"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(guidance.trim())
      }}
    >
      <label htmlFor={id}>What should Linus know before deciding again?</label>
      <textarea
        id={id}
        rows={4}
        maxLength={4000}
        value={guidance}
        onChange={(event) => {
          setGuidance(event.target.value)
        }}
        placeholder="The adapter ships on its own next week, so it stays in this PR."
        autoFocus
      />
      <div className="linus-actions">
        <Button size="sm" type="submit" disabled={busy || !guidance.trim()}>
          Ask Linus again
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
