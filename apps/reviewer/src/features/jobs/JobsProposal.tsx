import { useState } from 'react'
import { diffLines } from 'diff'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import type { JobsAdvice } from '../../../shared/domain/jobs'
import { linearMarkdown, type Ticket } from '../../../shared/domain/tickets'
import { TicketMarkdown } from '../../components/TicketMarkdown'
import { useClipboard } from '../../lib/useClipboard'

type Mode = 'preview' | 'changes' | 'edit'

/** Jobs's rewrite: read it, compare it, edit it, and only then replace the ticket in Linear. */
export function JobsProposal({
  ticket,
  advice,
  stale,
  disabled,
  onApply,
}: {
  ticket: Ticket
  advice: JobsAdvice
  stale: boolean
  disabled: boolean
  onApply: (changes: { title: string; description: string }) => void
}) {
  const [mode, setMode] = useState<Mode>('preview')
  const [title, setTitle] = useState(advice.revisedTitle || ticket.title)
  const [description, setDescription] = useState(advice.revisedDescription)
  const unchanged =
    title === ticket.title && linearMarkdown(description) === linearMarkdown(ticket.description)
  return (
    <div className="jobs-proposal">
      <div className="jobs-modes" role="tablist" aria-label="Proposal view">
        {(['preview', 'changes', 'edit'] as const).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={mode === item}
            onClick={() => {
              setMode(item)
            }}
          >
            {item === 'preview' ? 'Preview' : item === 'changes' ? 'Changes' : 'Edit'}
          </button>
        ))}
      </div>
      {mode === 'edit' ? (
        <ProposalEditor
          title={title}
          description={description}
          onTitle={setTitle}
          onDescription={setDescription}
        />
      ) : mode === 'changes' ? (
        <ProposalDiff before={ticket} after={{ title, description }} />
      ) : (
        <>
          <h3 className="jobs-proposal-title">{title}</h3>
          <TicketMarkdown markdown={description} label="Proposed description" />
        </>
      )}
      <ApplyControls
        identifier={ticket.identifier}
        changes={{ title: title.trim(), description: linearMarkdown(description) }}
        blocked={disabled || stale || unchanged || !title.trim()}
        disabled={disabled}
        stale={stale}
        onApply={onApply}
      />
    </div>
  )
}

function ProposalEditor(props: {
  title: string
  description: string
  onTitle: (title: string) => void
  onDescription: (description: string) => void
}) {
  return (
    <div className="jobs-editor">
      <Input
        aria-label="Proposed title"
        value={props.title}
        onChange={(event) => {
          props.onTitle(event.target.value)
        }}
      />
      <textarea
        aria-label="Proposed description"
        value={props.description}
        onChange={(event) => {
          props.onDescription(event.target.value)
        }}
        rows={24}
      />
    </div>
  )
}

function ApplyControls({
  identifier,
  changes,
  blocked,
  disabled,
  stale,
  onApply,
}: {
  identifier: string
  changes: { title: string; description: string }
  blocked: boolean
  disabled: boolean
  stale: boolean
  onApply: (changes: { title: string; description: string }) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const clipboard = useClipboard()
  return (
    <>
      <div className="jobs-actions">
        <Button
          variant="outline"
          onClick={() => void clipboard.copy(`${changes.title}\n\n${changes.description}`)}
        >
          {clipboard.state === 'copied' ? 'Copied' : 'Copy'}
        </Button>
        {confirming ? (
          <>
            <Button
              disabled={disabled}
              onClick={() => {
                setConfirming(false)
                onApply(changes)
              }}
            >
              Replace {identifier} in Linear
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false)
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            disabled={blocked}
            onClick={() => {
              setConfirming(true)
            }}
          >
            Apply to Linear
          </Button>
        )}
      </div>
      {confirming && (
        <p className="muted" role="status">
          This replaces the title and description everyone sees in Linear. Linear keeps the old
          version in its description history.
        </p>
      )}
      {stale && (
        <p className="inbox-warning" role="status">
          The ticket changed in Linear after this review. Review it again before applying.
        </p>
      )}
    </>
  )
}

function ProposalDiff({
  before,
  after,
}: {
  before: { title: string; description: string }
  after: { title: string; description: string }
}) {
  const parts = diffLines(
    `# ${before.title}\n\n${linearMarkdown(before.description)}\n`,
    `# ${after.title}\n\n${linearMarkdown(after.description)}\n`,
  )
  return (
    <pre className="jobs-diff" aria-label="Changes to the ticket">
      {parts.map((part, index) => (
        <span
          key={index}
          className={part.added ? 'jobs-diff-added' : part.removed ? 'jobs-diff-removed' : ''}
        >
          {part.value
            .replace(/\n$/, '')
            .split('\n')
            .map((line) => `${part.added ? '+ ' : part.removed ? '- ' : '  '}${line}`)
            .join('\n')}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}
