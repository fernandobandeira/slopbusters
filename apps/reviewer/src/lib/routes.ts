import { matchPath } from 'react-router'
import type { PullRequest } from '../../shared/domain/types'
import { parsePullUrl } from '../../shared/domain/pullUrl'
import type { InboxFilter } from '../features/inbox/inbox'
import {
  ticketIdentifierSchema,
  ticketViewSchema,
  type TicketView,
} from '../../shared/domain/tickets'

type InboxRoute = { kind: 'inbox'; repository?: string; filter: InboxFilter }
type PullRoute = {
  kind: 'pull'
  repository: string
  number: number
  revision?: string
  filter: InboxFilter
}
export type AppRoute =
  | InboxRoute
  | PullRoute
  | { kind: 'sessions'; id?: string; repository?: string; filter: InboxFilter }
  | { kind: 'settings'; repository?: undefined; filter: InboxFilter }
  | { kind: 'issues'; view: TicketView; repository?: undefined; filter: InboxFilter }
  | { kind: 'issue'; identifier: string; repository?: undefined; filter: InboxFilter }
  | { kind: 'not-found' }
export interface ReviewView {
  groupId?: string
  split: boolean
  /** Show whole sections instead of what changed since the previous review. */
  fullSections: boolean
}
export function readRoute(params: { pathname: string; search: string }): AppRoute {
  const query = new URLSearchParams(params.search)
  const filter = inboxFilter(query.get('inbox'))
  const page = readAppPage(params.pathname, query, filter)
  if (page) return page
  if (params.pathname === '/') return { kind: 'inbox', filter }
  const pull = matchPath('/repos/:owner/:repo/pulls/:number', params.pathname)
  const inbox = matchPath('/repos/:owner/:repo/pulls', params.pathname)
  const match = pull ?? inbox
  if (!match) return { kind: 'not-found' }
  const repository = validRepository(`${match.params.owner}/${match.params.repo}`)
  if (!repository) return { kind: 'not-found' }
  if (!pull) return { kind: 'inbox', repository, filter }
  if (!pull.params.number || !/^\d+$/.test(pull.params.number)) return { kind: 'not-found' }
  const number = Number(pull.params.number)
  if (!Number.isSafeInteger(number) || number <= 0) return { kind: 'not-found' }
  const revision = query.get('revision') ?? undefined
  if (revision && !/^[a-zA-Z0-9-]+$/.test(revision)) return { kind: 'not-found' }
  return { kind: 'pull', repository, number, revision, filter }
}

export function inboxPath(repository: string, filter: InboxFilter = 'mine'): string {
  const path = repository ? `/repos/${repository}/pulls` : '/'
  return `${path}?${new URLSearchParams({ inbox: filter })}`
}

export function reviewPath(params: { url: string; filter: InboxFilter }): string {
  const query = new URLSearchParams({ inbox: params.filter })
  const pr = parsePullUrl(params.url)
  return `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}?${query}`
}

export function routeMatchesPull(route: AppRoute, pull: PullRequest): boolean {
  return (
    route.kind === 'pull' &&
    route.repository === `${pull.owner}/${pull.repo}` &&
    route.number === pull.number
  )
}

export function readReviewView(query: URLSearchParams): ReviewView {
  return {
    groupId: query.get('group') ?? undefined,
    split: query.get('diff') === 'split',
    fullSections: query.get('sections') === 'full',
  }
}

export function updateReviewView(
  query: URLSearchParams,
  changes: Partial<ReviewView>,
): URLSearchParams {
  const next = new URLSearchParams(query)
  next.delete('view')
  next.delete('file')
  next.delete('priority')
  if ('groupId' in changes) {
    if (changes.groupId) next.set('group', changes.groupId)
    else next.delete('group')
  }
  if (changes.split !== undefined) {
    if (changes.split) next.set('diff', 'split')
    else next.delete('diff')
  }
  if (changes.fullSections !== undefined) {
    if (changes.fullSections) next.set('sections', 'full')
    else next.delete('sections')
  }
  return next
}

function inboxFilter(value: string | null): InboxFilter {
  if (value === 'others' || value === 'requested') return value
  return 'mine'
}
function validRepository(value: string | null): string | undefined {
  return value && /^[\w.-]+\/[\w.-]+$/.test(value) ? value : undefined
}

export function issuesPath(view: TicketView = 'assigned'): string {
  return `/issues?${new URLSearchParams({ view })}`
}
export function issuePath(identifier: string): string {
  return `/issues/${encodeURIComponent(identifier)}`
}

/** Pages outside a repository: sessions, settings, and Linear issues. */
function readAppPage(
  pathname: string,
  query: URLSearchParams,
  filter: InboxFilter,
): AppRoute | undefined {
  if (pathname === '/settings') return { kind: 'settings', filter }
  return readSessionRoute(pathname, query, filter) ?? readIssueRoute(pathname, query, filter)
}

function readIssueRoute(
  pathname: string,
  query: URLSearchParams,
  filter: InboxFilter,
): AppRoute | undefined {
  if (pathname === '/issues') {
    const view = ticketViewSchema.safeParse(query.get('view'))
    return { kind: 'issues', view: view.success ? view.data : 'assigned', filter }
  }
  const issue = matchPath('/issues/:identifier', pathname)
  if (!issue) return undefined
  const identifier = ticketIdentifierSchema.safeParse(issue.params.identifier?.toUpperCase())
  return identifier.success
    ? { kind: 'issue', identifier: identifier.data, filter }
    : { kind: 'not-found' }
}

function readSessionRoute(
  pathname: string,
  query: URLSearchParams,
  filter: InboxFilter,
): AppRoute | undefined {
  const sessions = matchPath('/sessions/:id', pathname)
  if (pathname === '/sessions' || sessions)
    return {
      kind: 'sessions',
      id: sessions?.params.id,
      repository: validRepository(query.get('repository')),
      filter,
    }
  return undefined
}
