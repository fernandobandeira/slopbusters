import { useCallback, useEffect, useRef, useState } from 'react'
import { UpdateButton } from './UpdateButton'
import { AppTitleBar } from './AppTitleBar'
import { RepositorySwitcher } from './RepositorySwitcher'
import { loadRepositoryHistory, saveRepositoryHistory, visitRepository } from './repositoryHistory'
import { Link, useLocation, useNavigate } from 'react-router'
import { inboxPath, readRoute, reviewPath, routeMatchesPull } from './routes'
import {
  ArrowUpRight,
  Check,
  GitPullRequest,
  GitPullRequestDraft,
  LoaderCircle,
  Plus,
  Settings,
} from 'lucide-react'
import { Button } from './vendor/t3/components/ui/button'
import { Badge } from './vendor/t3/components/ui/badge'
import { Input } from './vendor/t3/components/ui/input'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './vendor/t3/components/ui/dialog'
import { api, message } from './api'
import { inboxPulls, type InboxFilter } from './inbox'
import { ReviewWorkspace } from './ReviewWorkspace'
import { SettingsPage } from './SettingsPage'
import { OrganizationSettings } from './OrganizationSettings'
import type { Preferences, OrganizationPreferences } from '../shared/preferences'
import { StackBadge } from './StackBadge'
import { StackDialog } from './StackPanel'
import { PullStatusDialog } from './PullStatusDialog'
import { PullStatusIcons, type PullStatusSection } from './PullStatusIcons'
import { inboxSections } from './inboxSections'
import { ConnectionStatus } from './ConnectionStatus'
import type { AppStatus, PullRequest, Repository, RepositoryInbox } from '../shared/types'
import type { PullStatus } from '../shared/pullStatus'

const filters: { id: InboxFilter; label: string }[] = [
  { id: 'mine', label: 'My PRs' },
  { id: 'others', label: 'Others’ PRs' },
  { id: 'requested', label: 'Review requested' },
]

export function App() {
  const [titlebarTarget, setTitlebarTarget] = useState<HTMLDivElement | null>(null)
  const [status, setStatus] = useState<AppStatus>()
  const [repositories, setRepositories] = useState<Repository[]>([])
  const location = useLocation()
  const navigate = useNavigate()
  const route = readRoute(location)
  const [repositoryHistory, setRepositoryHistory] = useState(loadRepositoryHistory)
  const visitedRepository =
    route.kind === 'inbox' || route.kind === 'pull' ? route.repository : undefined
  const recentRepositories = visitedRepository
    ? visitRepository(repositoryHistory, visitedRepository)
    : repositoryHistory
  if (recentRepositories !== repositoryHistory) setRepositoryHistory(recentRepositories)
  const lastRepository = recentRepositories[0] ?? ''
  const repository =
    route.kind === 'not-found' ? lastRepository : (route.repository ?? lastRepository)
  const filter = route.kind === 'not-found' ? 'mine' : route.filter
  const [inboxResult, setInboxResult] = useState<{ key: string; data?: RepositoryInbox }>()
  const [inboxStatusResult, setInboxStatusResult] = useState<{
    key: string
    statuses: { number: number; status: PullStatus }[]
    warnings: string[]
  }>()
  const [urlDialog, setUrlDialog] = useState(false)
  const [url, setUrl] = useState('')
  const [stackTarget, setStackTarget] = useState<{ url: string; number: number }>()
  const [statusTarget, setStatusTarget] = useState<{ url: string; section?: PullStatusSection }>()
  const [pullResult, setPullResult] = useState<{
    key: string
    pull?: PullRequest
    error?: string
  }>()
  const pullCache = useRef(new Map<string, PullRequest>())
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [preferences, setPreferences] = useState<Preferences>()
  const [preferencesError, setPreferencesError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void api<Preferences>('/preferences', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) {
          setPreferences(result)
          setPreferencesError('')
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setPreferencesError(message(cause))
      })
    return () => controller.abort()
  }, [refresh])
  async function saveOrganization(organization: OrganizationPreferences) {
    const result = await api<Preferences>('/preferences', {
      method: 'PUT',
      body: JSON.stringify({ organization }),
    })
    setPreferences(result)
    setPreferencesError('')
  }
  const pullUrl =
    route.kind === 'pull' ? `https://github.com/${route.repository}/pull/${route.number}` : ''
  const revision = route.kind === 'pull' ? route.revision : undefined
  const pullKey = pullUrl ? `${pullUrl}@${revision ?? 'latest'}` : ''
  const pull = pullResult?.key === pullKey ? pullResult.pull : undefined
  const loading = Boolean(pullKey && pullResult?.key !== pullKey)
  const displayError = error || (pullResult?.key === pullKey ? pullResult.error : '')

  useEffect(() => {
    const initialRepository = repository || repositories[0]?.fullName
    if (location.pathname === '/' && initialRepository) {
      void navigate(inboxPath(initialRepository, filter), { replace: true })
    }
  }, [location.pathname, repository, repositories, filter, navigate])

  useEffect(() => {
    const controller = new AbortController()
    void api<AppStatus>('/status', { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setStatus(result)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
    void api<{ repositories: Repository[] }>('/repositories', { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setRepositories(result.repositories)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error))
      })
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    saveRepositoryHistory(recentRepositories)
  }, [recentRepositories])

  const requestKey = `${repository}:${refresh}`
  const statusRequestKey = `${requestKey}:${filter}`
  const coreInbox = inboxResult?.key === requestKey ? inboxResult.data : undefined
  const inboxStatus = inboxStatusResult?.key === statusRequestKey ? inboxStatusResult : undefined
  const statuses = new Map(inboxStatus?.statuses.map((entry) => [entry.number, entry.status]))
  const inbox = coreInbox && {
    ...coreInbox,
    warnings: [...(coreInbox.warnings ?? []), ...(inboxStatus?.warnings ?? [])],
    pulls: coreInbox.pulls.map((pr) => {
      const status = statuses.get(pr.number)
      return { ...pr, status: status?.headSha === pr.headSha ? status : pr.status }
    }),
  }
  const inboxLoading = Boolean(repository && inboxResult?.key !== requestKey)

  useEffect(() => {
    if (!repository || route.kind !== 'inbox') return
    const controller = new AbortController()
    void api<RepositoryInbox>(`/inbox?repository=${encodeURIComponent(repository)}`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setInboxResult({ key: requestKey, data })
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setInboxResult({ key: requestKey })
          setError(message(error))
        }
      })
    return () => controller.abort()
  }, [repository, requestKey, route.kind])

  useEffect(() => {
    if (!repository || route.kind !== 'inbox') return
    const controller = new AbortController()
    void api<{ statuses: { number: number; status: PullStatus }[]; warnings: string[] }>(
      `/inbox-status?${new URLSearchParams({ repository, filter: filter === 'mine' ? 'mine' : 'all', refresh: refresh ? '1' : '0' })}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setInboxStatusResult({ key: statusRequestKey, ...result })
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setInboxStatusResult({
            key: statusRequestKey,
            statuses: [],
            warnings: [`Could not load checks and review status: ${message(cause)}`],
          })
      })
    return () => controller.abort()
  }, [repository, statusRequestKey, route.kind, filter, refresh])

  useEffect(() => {
    if (!pullUrl) return
    const controller = new AbortController()
    const fromGitHub = () =>
      api<PullRequest>('/pulls', {
        method: 'POST',
        body: JSON.stringify({ url: pullUrl }),
        signal: controller.signal,
      })
    const cached = revision ? pullCache.current.get(pullKey) : undefined
    let load: Promise<PullRequest>
    if (cached) load = Promise.resolve(cached)
    else if (revision) {
      load = api<PullRequest>(`/pulls/${revision}`, { signal: controller.signal })
        .then((pr) => {
          if (
            !routeMatchesPull(
              readRoute({ pathname: window.location.pathname, search: window.location.search }),
              pr,
            )
          )
            throw new Error('This snapshot belongs to another PR.')
          return pr
        })
        .catch((error) => {
          if (controller.signal.aborted) throw error
          return fromGitHub()
        })
    } else load = fromGitHub()
    void load
      .then((pr) => {
        if (controller.signal.aborted) return
        pullCache.current.set(pullKey, pr)
        pullCache.current.set(`${pullUrl}@${pr.id}`, pr)
        setPullResult({ key: pullKey, pull: pr })
        if (revision !== pr.id) {
          const search = new URLSearchParams(window.location.search)
          search.set('revision', pr.id)
          void navigate(
            { pathname: window.location.pathname, search: `?${search}` },
            { replace: true },
          )
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setPullResult({ key: pullKey, error: message(error) })
      })
    return () => controller.abort()
  }, [pullUrl, revision, pullKey, navigate])

  const updatePull = useCallback(
    (pr: PullRequest) => {
      pullCache.current.set(pullKey, pr)
      setPullResult({ key: pullKey, pull: pr })
    },
    [pullKey],
  )

  async function reloadPull() {
    if (!pull) return
    const pathname = location.pathname
    const stillViewingSnapshot = () => {
      const current = readRoute({
        pathname: window.location.pathname,
        search: window.location.search,
      })
      return (
        current.kind === 'pull' && routeMatchesPull(current, pull) && current.revision === revision
      )
    }
    setReloading(true)
    setError('')
    try {
      const pr = await api<PullRequest>('/pulls', {
        method: 'POST',
        body: JSON.stringify({ url: pull.url }),
      })
      pullCache.current.set(`${pr.url}@${pr.id}`, pr)
      if (!stillViewingSnapshot()) return
      if (pr.id === pull.id) updatePull(pr)
      else {
        const search = new URLSearchParams(window.location.search)
        search.set('revision', pr.id)
        search.delete('group')
        search.delete('file')
        void navigate({ pathname, search: `?${search}` }, { replace: true })
      }
    } catch (error) {
      if (stillViewingSnapshot()) setError(message(error))
    } finally {
      setReloading(false)
    }
  }

  function openPull(pullUrl: string) {
    try {
      void navigate(reviewPath({ url: pullUrl, filter }))
      setError('')
      setUrlDialog(false)
    } catch (error) {
      setError(message(error))
    }
  }
  const visible = inbox ? inboxPulls(inbox, filter) : []
  const sections =
    filter === 'mine' ? inboxSections(visible) : [{ id: 'all', label: '', pulls: visible }]
  return (
    <div className="app-frame">
      <AppTitleBar
        contentRef={setTitlebarTarget}
        navigation={
          route.kind !== 'pull' ? 'app' : pull?.groupingSource !== 'files' ? 'review' : 'none'
        }
      >
        {!pull && (
          <div className="app-page-title">
            {route.kind === 'inbox' ? (
              <RepositorySwitcher
                repository={repository}
                repositories={repositories}
                recentRepositories={recentRepositories}
                unavailableMessage={status?.github.detail}
                onSelect={(name) => {
                  void navigate(inboxPath(name, filter))
                  setError('')
                }}
              />
            ) : (
              <h1>
                {route.kind === 'settings'
                  ? 'Settings'
                  : route.kind === 'not-found'
                    ? 'Page not found'
                    : `PR #${route.number}`}
              </h1>
            )}
            {route.kind === 'inbox' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setError('')
                  setRefresh((value) => value + 1)
                }}
              >
                Refresh
              </Button>
            )}
          </div>
        )}
      </AppTitleBar>
      <div className="app-shell">
        {route.kind !== 'pull' && (
          <aside className="app-sidebar">
            <div className="sidebar-label">PULL REQUESTS</div>
            <nav aria-label="Pull request inbox">
              {filters.map((item) => (
                <button
                  key={item.id}
                  className={`nav-row ${filter === item.id && route.kind === 'inbox' ? 'active' : ''}`}
                  onClick={() => void navigate(inboxPath(repository, item.id))}
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
              onClick={() => setUrlDialog(true)}
            >
              <Plus size={14} />
              Open PR by URL
            </Button>
            <div className="sidebar-bottom">
              <Link
                className={`nav-row ${route.kind === 'settings' ? 'active' : ''}`}
                to="/settings"
              >
                <Settings size={15} /> Settings
              </Link>
              <ConnectionStatus status={status} />
            </div>
          </aside>
        )}
        <main className="app-main">
          {preferencesError && (
            <div className="error-banner" role="alert">
              Could not load your preferences: {preferencesError}
              <Button size="xs" variant="ghost" onClick={() => setRefresh((value) => value + 1)}>
                Retry
              </Button>
            </div>
          )}
          {displayError && (
            <div role="alert" className="error-banner">
              {displayError}
              <Button size="xs" variant="ghost" onClick={() => setError('')}>
                Dismiss
              </Button>
            </div>
          )}
          {loading && (
            <div className="loading-banner" role="status">
              <LoaderCircle size={15} className="animate-spin" />
              Loading the PR and its original source…
            </div>
          )}
          {pull ? (
            <ReviewWorkspace
              key={pull.id}
              pull={pull}
              onUpdate={updatePull}
              organization={preferences?.organization}
              onReload={() => void reloadPull()}
              reloading={reloading}
              inboxUrl={inboxPath(repository, filter)}
              titlebarTarget={titlebarTarget}
            />
          ) : route.kind === 'settings' ? (
            <SettingsPage
              key={preferences ? 'loaded' : 'loading'}
              inboxUrl={inboxPath(repository, filter)}
              organization={preferences?.organization}
              status={status}
              onSave={saveOrganization}
            />
          ) : route.kind === 'not-found' ? (
            <div className="empty-state">
              <strong>Page not found</strong>
              <Link to={inboxPath(repository, filter)}>Back to inbox</Link>
            </div>
          ) : loading || route.kind === 'pull' ? (
            <div className="empty-state">
              {loading ? 'Loading review…' : 'Unable to open this PR.'}
              <Link to={inboxPath(repository, filter)}>Back to inbox</Link>
              {!loading && (
                <Button variant="outline" onClick={() => window.location.reload()}>
                  Try again
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="inbox-content">
                <div className="eyebrow">YOUR REVIEW WORKSPACE</div>
                <h1>Pull requests</h1>
                <p className="muted">Pick a change. Read the code. Leave useful feedback.</p>
                <div className="inbox-tabs" role="tablist" aria-label="Inbox filter">
                  {filters.map((item) => (
                    <button
                      role="tab"
                      aria-selected={item.id === filter}
                      key={item.id}
                      onClick={() => void navigate(inboxPath(repository, item.id))}
                    >
                      {item.label}
                      <span className="count">
                        {inbox ? inboxPulls(inbox, item.id).length : '—'}
                      </span>
                    </button>
                  ))}
                </div>
                {inbox?.warnings?.map((warning) => (
                  <p key={warning} role="status" className="inbox-warning">
                    {warning}
                  </p>
                ))}
                {!inboxLoading && repository && !inboxStatus && filter !== 'mine' && (
                  <p role="status" className="inbox-metadata-loading">
                    Loading checks and review status…
                  </p>
                )}
                {inboxLoading ? (
                  <div className="empty-state" role="status">
                    <LoaderCircle className="animate-spin" size={22} />
                    Loading open pull requests…
                  </div>
                ) : visible.length ? (
                  <div className="pr-list">
                    {sections.map((section) => (
                      <section
                        className="inbox-section"
                        key={section.id}
                        aria-label={section.label || 'Pull requests'}
                      >
                        {section.label && (
                          <h2 className="inbox-section-title">
                            {section.id === 'unknown' && !inboxStatus
                              ? 'Checking status'
                              : section.label}
                            <span>{section.pulls.length}</span>
                          </h2>
                        )}
                        {section.pulls.map((pr) => (
                          <div className="pr-row" key={pr.number}>
                            <Link className="pr-row-link" to={reviewPath({ url: pr.url, filter })}>
                              {pr.isDraft ? (
                                <GitPullRequestDraft
                                  size={19}
                                  className="muted"
                                  aria-label="Draft pull request"
                                  aria-hidden={false}
                                  role="img"
                                />
                              ) : (
                                <GitPullRequest
                                  size={19}
                                  className="green"
                                  aria-label="Open pull request"
                                  aria-hidden={false}
                                  role="img"
                                />
                              )}
                              <div>
                                <strong>{pr.title}</strong>
                                <span className="muted">
                                  #{pr.number} opened by {pr.author} · updated{' '}
                                  {new Date(pr.updatedAt).toLocaleDateString()}
                                </span>
                              </div>
                              {pr.reviewRequested && (
                                <Badge variant="info">Your review requested</Badge>
                              )}
                            </Link>
                            {pr.stack && (
                              <StackBadge
                                summary={pr.stack}
                                onClick={() => setStackTarget({ url: pr.url, number: pr.number })}
                              />
                            )}
                            {pr.status ? (
                              <PullStatusIcons
                                status={pr.status}
                                onSelect={(section) => setStatusTarget({ url: pr.url, section })}
                              />
                            ) : (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setStatusTarget({ url: pr.url })}
                              >
                                Checks and reviews
                              </Button>
                            )}
                            <a
                              className="pr-external-link muted"
                              href={pr.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open PR #${pr.number} on GitHub`}
                              title="Open on GitHub"
                            >
                              <ArrowUpRight size={16} aria-hidden="true" />
                            </a>
                          </div>
                        ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Check size={22} />
                    <strong>
                      {repository ? 'No open PRs in this view' : 'Choose a repository to begin'}
                    </strong>
                    <span className="muted">
                      {repository
                        ? 'Switch tabs to see other pull requests.'
                        : 'Sign in with gh auth login, then select a repository.'}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
        <StackDialog
          url={stackTarget?.url}
          currentNumber={stackTarget?.number ?? 0}
          filter={filter}
          onClose={() => setStackTarget(undefined)}
        />
        <PullStatusDialog
          url={statusTarget?.url}
          section={statusTarget?.section}
          onClose={() => setStatusTarget(undefined)}
        />
        <Dialog open={urlDialog} onOpenChange={setUrlDialog}>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Open a pull request</DialogTitle>
              <DialogDescription>
                Paste a GitHub URL, including PRs from other repositories.
              </DialogDescription>
            </DialogHeader>
            <form
              className="dialog-body"
              onSubmit={(event) => {
                event.preventDefault()
                void openPull(url)
              }}
            >
              <Input
                autoFocus
                aria-label="Pull request URL"
                placeholder="https://github.com/owner/repo/pull/123"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
              />
              {error && (
                <p role="alert" className="error-text">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <Button type="submit" disabled={loading || !url.trim()}>
                  {loading ? 'Loading…' : 'Open PR'}
                </Button>
              </div>
            </form>
          </DialogPopup>
        </Dialog>
      </div>
      <Dialog open={Boolean(preferences && !preferences.organization)}>
        <DialogPopup showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Choose your coding provider</DialogTitle>
            <DialogDescription>Set up automatic grouping for your pull requests.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <OrganizationSettings firstRun status={status} onSave={saveOrganization} />
          </div>
        </DialogPopup>
      </Dialog>
      <UpdateButton />
    </div>
  )
}
