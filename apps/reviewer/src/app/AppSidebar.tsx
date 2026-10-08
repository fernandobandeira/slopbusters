import { Link } from 'react-router'
import { GitPullRequest, Plus, Settings, MessagesSquare, CircleDot } from 'lucide-react'
import { ticketViews, type TicketView } from '../../shared/domain/tickets'
import { issuesPath } from '../lib/routes'
import { Button } from '~/components/ui/button'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { inboxPulls, inboxFilters as filters, type InboxFilter } from '../features/inbox/inbox'
import type { AppStatus, RepositoryInbox } from '../../shared/domain/types'
export function AppSidebar({
  filter,
  repository,
  sessionsPage,
  inbox,
  status,
  settings,
  inboxPage,
  issuesView,
  onFilter,
  onOpenUrl,
}: {
  filter: InboxFilter
  repository?: string
  sessionsPage?: boolean
  inbox?: RepositoryInbox
  status?: AppStatus
  settings: boolean
  inboxPage: boolean
  /** The issue list shown, or `open` while reading one issue. */
  issuesView?: TicketView | 'open'
  onFilter: (filter: InboxFilter) => void
  onOpenUrl: () => void
}) {
  return (
    <aside className="app-sidebar">
      <div className="sidebar-label">PULL REQUESTS</div>
      <nav aria-label="Pull request inbox">
        {filters.map((item) => (
          <button
            key={item.id}
            className={`nav-row ${filter === item.id && inboxPage ? 'active' : ''}`}
            onClick={() => {
              onFilter(item.id)
            }}
          >
            <GitPullRequest size={15} />
            <span>{item.label}</span>
            <span className="count">{inbox ? inboxPulls(inbox, item.id).length : '—'}</span>
          </button>
        ))}
      </nav>
      <Button
        variant="ghost"
        size="sm"
        className="open-url"
        onClick={() => {
          onOpenUrl()
        }}
      >
        <Plus size={14} />
        Open PR by URL
      </Button>
      <IssuesNavigation active={issuesView} />
      <Link
        className={`nav-row ${sessionsPage ? 'active' : ''}`}
        to={`/sessions${repository ? `?${new URLSearchParams({ repository })}` : ''}`}
      >
        <MessagesSquare size={15} />
        Sessions
      </Link>
      <div className="sidebar-bottom">
        <Link className={`nav-row ${settings ? 'active' : ''}`} to="/settings">
          <Settings size={15} /> Settings
        </Link>
        <ConnectionStatus status={status} />
      </div>
    </aside>
  )
}

function IssuesNavigation({ active }: { active?: TicketView | 'open' }) {
  return (
    <>
      <div className="sidebar-label sidebar-label-spaced">ISSUES</div>
      <nav aria-label="Linear issues">
        {ticketViews.map((item) => (
          <Link
            key={item.id}
            className={`nav-row ${active === item.id ? 'active' : ''}`}
            to={issuesPath(item.id)}
          >
            <CircleDot size={15} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </>
  )
}
