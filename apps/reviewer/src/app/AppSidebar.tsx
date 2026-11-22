import { Link } from 'react-router'
import {
  GitPullRequestArrow,
  Plus,
  Settings,
  MessagesSquare,
  CircleDot,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { ticketViews, type TicketView } from '../../shared/domain/tickets'
import { issuesPath } from '../lib/routes'
import { Button } from '~/components/ui/button'
import { ConnectionStatus } from '../components/ConnectionStatus'
import { inboxPulls, inboxFilters as filters } from '../features/inbox/inbox'
import type { InboxFilter } from '../lib/routes'
import type { AppStatus, RepositoryInbox } from '../../shared/domain/types'

const filterIcons = { mine: UserRound, others: UsersRound, requested: GitPullRequestArrow }

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
        {filters.map((item) => {
          const Icon = filterIcons[item.id]
          const active = filter === item.id && inboxPage
          const count = inbox ? inboxPulls(inbox, item.id).length : undefined
          return (
            <button
              key={item.id}
              className={`nav-row ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              aria-label={count === undefined ? item.label : `${item.label} (${String(count)})`}
              title={item.label}
              onClick={() => {
                onFilter(item.id)
              }}
            >
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
              <span className="count">{count ?? '—'}</span>
            </button>
          )
        })}
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
