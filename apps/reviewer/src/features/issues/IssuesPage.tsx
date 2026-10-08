import { useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { listTickets } from '../../../shared/api/tickets'
import {
  ticketIdentifierIn,
  ticketViews,
  type TicketSummary,
  type TicketView,
} from '../../../shared/domain/tickets'
import { call, message } from '../../lib/api'
import { issuePath, issuesPath } from '../../lib/routes'
import { useApiQuery } from '../../lib/useApiQuery'
import { LinearConnectButton } from '../../components/LinearConnect'
import { IssueRow } from './IssueRow'
import { useLinearStatus } from '../../lib/useLinearStatus'
import './issues.css'

export function IssuesPage({
  view,
  renderBadge,
}: {
  view: TicketView
  renderBadge: (ticket: TicketSummary) => ReactNode
}) {
  const navigate = useNavigate()
  const [refresh, setRefresh] = useState(0)
  const status = useLinearStatus(refresh)
  const connected = status.data?.connected === true
  return (
    <div className="inbox-content issues-content">
      <div className="eyebrow">PLANS BEFORE CODE</div>
      <h1>Issues</h1>
      <p className="muted">
        Make each ticket clear enough to build from before anyone writes code.
      </p>
      <div className="inbox-tabs" role="tablist" aria-label="Issue filter">
        {ticketViews.map((item) => (
          <button
            role="tab"
            key={item.id}
            aria-selected={item.id === view}
            onClick={() => void navigate(issuesPath(item.id))}
          >
            {item.label}
          </button>
        ))}
      </div>
      <OpenIssue />
      {status.error && (
        <p role="alert" className="inbox-warning">
          {status.error}
        </p>
      )}
      {status.data && !connected && (
        <div className="empty-state issues-connect">
          <strong>Connect Linear to see your issues</strong>
          <p className="muted">{status.data.detail}</p>
          {status.data.connecting ? (
            <p role="status">Approve access in your browser. This page updates when you do.</p>
          ) : status.data.oauthAvailable ? (
            <LinearConnectButton
              onStarted={() => {
                setRefresh((value) => value + 1)
              }}
            />
          ) : (
            <Link to="/settings#linear-settings-title">Add a Linear API key in Settings</Link>
          )}
        </div>
      )}
      {connected && <IssueList key={view} view={view} renderBadge={renderBadge} />}
    </div>
  )
}

function OpenIssue() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const identifier = ticketIdentifierIn(value, { ignoreCase: true })
  return (
    <form
      className="issues-open"
      onSubmit={(event) => {
        event.preventDefault()
        if (identifier) void navigate(issuePath(identifier))
      }}
    >
      <Input
        aria-label="Issue ID or Linear URL"
        placeholder="Open an issue: PRD-123 or a Linear link"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
        }}
      />
      <Button type="submit" variant="outline" disabled={!identifier}>
        Open
      </Button>
    </form>
  )
}

function IssueList({
  view,
  renderBadge,
}: {
  view: TicketView
  renderBadge: (ticket: TicketSummary) => ReactNode
}) {
  const first = useApiQuery(listTickets, { query: { view } })
  const [more, setMore] = useState<{ tickets: TicketSummary[]; next: string | null }>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const tickets = [...(first.data?.tickets ?? []), ...(more?.tickets ?? [])]
  const next = more ? more.next : (first.data?.next ?? null)
  async function loadMore() {
    if (!next) return
    setLoadingMore(true)
    try {
      const page = await call(listTickets, { query: { view, after: next } })
      setMore((previous) => ({
        tickets: [...(previous?.tickets ?? []), ...page.tickets],
        next: page.next,
      }))
    } catch (cause) {
      setError(message(cause))
    } finally {
      setLoadingMore(false)
    }
  }
  if (first.error || error)
    return (
      <p role="alert" className="inbox-warning">
        {first.error ?? error}
      </p>
    )
  if (first.loading)
    return (
      <p role="status" className="muted">
        Loading issues…
      </p>
    )
  if (!tickets.length) return <div className="empty-state">No open issues here.</div>
  return (
    <div className="issue-list">
      {tickets.map((ticket) => (
        <IssueRow key={ticket.identifier} ticket={ticket} badge={renderBadge(ticket)} />
      ))}
      {next && (
        <Button variant="ghost" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  )
}
