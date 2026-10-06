import { AgentSessionCard } from '../features/agent-sessions/AgentSessionCard'
import { SessionsPage } from '../features/agent-sessions/SessionsPage'
import type { Repository } from '../../shared/domain/types'
import { GandalfCompanion } from '../features/gandalf/GandalfCompanion'
import { inboxSections } from '../features/inbox/inboxSections'
import { BobCompanion } from '../features/bob/BobCompanion'
import { AppSidebar } from './AppSidebar'
import { InboxPullActions } from './InboxPullActions'
import { useReviewLaunch } from './useReviewLaunch'
import type { ReviewCompanion } from '../components/StartReviewButton'
import { PullReviewActions } from './PullReviewActions'
import { useApiQuery } from '../lib/useApiQuery'
import { usePullReview } from '../features/review/usePullReview'
import { InboxPage } from '../features/inbox/InboxPage'
import { usePreferences } from '../lib/usePreferences'
import { useInbox } from '../features/inbox/useInbox'
import * as routes from '../../shared/api'
import { useCallback, useEffect, useState } from 'react'
import { UpdateButton } from '../components/UpdateButton'
import { AppTitleBar } from './AppTitleBar'
import { RepositorySwitcher } from '../features/inbox/RepositorySwitcher'
import {
  loadRepositoryHistory,
  saveRepositoryHistory,
  visitRepository,
} from '../features/inbox/repositoryHistory'
import { Link, Routes, Route, useLocation, useNavigate } from 'react-router'
import { inboxPath, readRoute, reviewPath } from '../lib/routes'
import { PullLoadingState } from '../features/review/PullLoadingState'
import { Button } from '~/components/ui/button'

import { Input } from '~/components/ui/input'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '~/components/ui/dialog'
import { message } from '../lib/api'
import { inboxPulls } from '../features/inbox/inbox'
import { ReviewWorkspace } from '../features/review/ReviewWorkspace'
import { SettingsPage } from '../features/settings/SettingsPage'
import { OrganizationSettings } from '../features/settings/OrganizationSettings'

import { StackDialog } from '../features/stacks/StackPanel'
import { PullStatusDialog } from '../features/pull-status/PullStatusDialog'
import { type PullStatusSection } from '../features/pull-status/PullStatusIcons'

import { LinusCompanion } from '../features/linus/LinusCompanion'

import { useLinusRecommendations } from '../features/linus/useLinusRecommendations'
import type { LinusReplayRequest } from '../../shared/domain/linus'

const emptyRepositories: Repository[] = []

export function App() {
  const [titlebarTarget, setTitlebarTarget] = useState<HTMLDivElement | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const route = readRoute(location)
  const [repositoryHistory, setRepositoryHistory] = useState(loadRepositoryHistory)
  const visitedRepository =
    route.kind === 'inbox' || route.kind === 'pull' || route.kind === 'sessions'
      ? route.repository
      : undefined
  const recentRepositories = visitedRepository
    ? visitRepository(repositoryHistory, visitedRepository)
    : repositoryHistory
  if (recentRepositories !== repositoryHistory) setRepositoryHistory(recentRepositories)
  const lastRepository = recentRepositories[0] ?? ''
  const repository =
    route.kind === 'not-found' ? lastRepository : (route.repository ?? lastRepository)
  const filter = route.kind === 'not-found' ? 'mine' : route.filter
  const [urlDialog, setUrlDialog] = useState(false)
  const [url, setUrl] = useState('')
  const [stackTarget, setStackTarget] = useState<{ url: string; number: number }>()
  const [statusTarget, setStatusTarget] = useState<{ url: string; section?: PullStatusSection }>()
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const statusQuery = useApiQuery(routes.getStatus, {}, { refresh })
  const repositoryQuery = useApiQuery(routes.getRepositories, {}, { refresh })
  const status = statusQuery.data
  const repositories = repositoryQuery.data?.repositories ?? emptyRepositories
  const [gandalfRepository, setGandalfRepository] = useState<string>()
  const refreshAfterGandalf = useCallback(() => {
    setRefresh((value) => value + 1)
  }, [])
  const closeGandalf = useCallback(() => {
    setGandalfRepository(undefined)
  }, [])
  const [linusSelection, setLinusSelection] = useState<{ repository: string; urls: string[] }>()
  const [linusRefresh, setLinusRefresh] = useState(0)
  const [linusReplay, setLinusReplay] = useState<LinusReplayRequest & { repository: string }>()
  const savedLinus = useLinusRecommendations(repository, refresh + linusRefresh)
  const savedBob = useApiQuery(
    routes.savedBobReviews,
    { query: { repository } },
    {
      enabled: Boolean(repository) && (route.kind === 'inbox' || route.kind === 'pull'),
      refresh: refresh + linusRefresh,
    },
  )
  const bobReviews = new Map(savedBob.data?.reviews.map((review) => [review.url, review]))
  const bobReplayId = new URLSearchParams(location.search).get('bob') ?? undefined
  function openBob(url: string, sessionId: string) {
    const target = new URL(
      pull?.url === url ? location.pathname + location.search : reviewPath({ url, filter }),
      window.location.origin,
    )
    target.searchParams.set('bob', sessionId)
    void navigate(target.pathname + target.search)
  }
  const reviewLaunch = useReviewLaunch({ repository, onBobOpen: openBob, onError: setError })
  function startReview(companion: ReviewCompanion, url: string) {
    if (companion === 'linus') {
      setLinusReplay(undefined)
      setLinusSelection(undefined)
    }
    void reviewLaunch.start(companion, url)
  }
  function closeBob() {
    const query = new URLSearchParams(location.search)
    query.delete('bob')
    void navigate(location.pathname + '?' + query.toString(), { replace: true })
  }

  const activeLinusReplay = linusReplay?.repository === repository ? linusReplay : undefined
  const linusSessionId =
    reviewLaunch.linusSession?.repository === repository ? reviewLaunch.linusSession.id : undefined
  const recommendations = new Map(
    savedLinus.recommendations.map((recommendation) => [recommendation.url, recommendation]),
  )
  const refreshLinus = useCallback(() => {
    setLinusRefresh((value) => value + 1)
  }, [])
  const selectingForLinus =
    route.kind === 'inbox' && filter === 'mine' && linusSelection?.repository === repository
  const {
    preferences,
    preferencesError,
    saveOrganization,
    saveCompanion,
    reload: reloadPreferences,
  } = usePreferences()
  useEffect(() => {
    if (refresh) reloadPreferences()
  }, [refresh, reloadPreferences])
  const { pull, loading, pullError, retryPull, updatePull, reloadPull, reloading } = usePullReview(
    route,
    location.pathname,
    navigate,
    setError,
  )
  const { inbox, inboxLoading, inboxError, inboxStatusLoading } = useInbox(repository, {
    filter,
    refresh,
    enabled: route.kind === 'inbox',
  })
  const displayError = error || inboxError || statusQuery.error || repositoryQuery.error
  useEffect(() => {
    const initialRepository = repository || repositories[0]?.fullName
    if (location.pathname === '/' && initialRepository) {
      void navigate(inboxPath(initialRepository, filter), { replace: true })
    }
  }, [location.pathname, repository, repositories, filter, navigate])

  useEffect(() => {
    saveRepositoryHistory(recentRepositories)
  }, [recentRepositories])

  function openPull(pullUrl: string) {
    try {
      void navigate(reviewPath({ url: pullUrl, filter }))
      setError('')
      setUrlDialog(false)
    } catch (error) {
      setError(message(error))
    }
  }
  function renderSessionCard(sessionId: string) {
    return <AgentSessionCard sessionId={sessionId} repository={repository} />
  }
  const myPulls = inbox ? inboxPulls(inbox, 'mine') : []
  const selectedLinusUrls =
    linusSelection?.repository === repository
      ? linusSelection.urls.filter((url) => myPulls.some((pr) => pr.url === url))
      : []
  const inboxPage = (
    <InboxPage
      repository={repository}
      filter={filter}
      inbox={inbox}
      inboxLoading={inboxLoading}
      statusLoading={inboxStatusLoading}
      recommendationsError={savedLinus.error}
      bobReviewsError={savedBob.error}
      selectingForLinus={selectingForLinus}
      selectedLinusUrls={selectedLinusUrls}
      onSelectionChange={(urls) => {
        setLinusSelection({ repository, urls })
      }}
      onFilter={(next) => void navigate(inboxPath(repository, next))}
      onResolveConflicts={() => {
        setGandalfRepository(repository)
        setLinusSelection(undefined)
        setLinusReplay(undefined)
        reviewLaunch.closeLinus()
      }}
      renderPullActions={(pr) => (
        <InboxPullActions
          pull={pr}
          recommendation={recommendations.get(pr.url)}
          bobReview={bobReviews.get(pr.url)}
          onStartReview={
            filter === 'mine'
              ? (companion) => {
                  startReview(companion, pr.url)
                }
              : undefined
          }
          reviewStarting={reviewLaunch.starting === pr.url}
          reviewStartDisabled={Boolean(reviewLaunch.starting)}
          onBobReplay={(review) => {
            openBob(pr.url, review.sessionId)
          }}
          onReplay={(recommendation) => {
            setLinusSelection(undefined)
            setLinusReplay({ repository, sessionId: recommendation.sessionId, url: pr.url })
          }}
          onStack={() => {
            setStackTarget({ url: pr.url, number: pr.number })
          }}
          onStatus={(section) => {
            setStatusTarget({ url: pr.url, section })
          }}
        />
      )}
    />
  )
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
                {route.kind === 'sessions'
                  ? 'Agent sessions'
                  : route.kind === 'settings'
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
          <AppSidebar
            filter={filter}
            inbox={inbox}
            status={status}
            repository={repository}
            sessionsPage={route.kind === 'sessions'}
            settings={route.kind === 'settings'}
            inboxPage={route.kind === 'inbox'}
            onFilter={(next) => {
              void navigate(inboxPath(repository, next))
            }}
            onOpenUrl={() => {
              setUrlDialog(true)
            }}
          />
        )}
        <main className="app-main">
          {preferencesError && (
            <div className="error-banner" role="alert">
              Could not load your preferences: {preferencesError}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setRefresh((value) => value + 1)
                }}
              >
                Retry
              </Button>
            </div>
          )}
          {displayError && (
            <div role="alert" className="error-banner">
              {displayError}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setError('')
                }}
              >
                Dismiss
              </Button>
            </div>
          )}
          <Routes>
            <Route
              path="/sessions"
              element={
                <SessionsPage
                  repository={route.kind === 'sessions' ? route.repository : undefined}
                />
              }
            />
            <Route
              path="/sessions/:id"
              element={
                <SessionsPage
                  id={route.kind === 'sessions' ? route.id : undefined}
                  repository={route.kind === 'sessions' ? route.repository : undefined}
                />
              }
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  key={preferences ? 'loaded' : 'loading'}
                  inboxUrl={inboxPath(repository, filter)}
                  organization={preferences?.organization}
                  companion={preferences?.companion}
                  status={status}
                  onSave={saveOrganization}
                  onSaveCompanion={saveCompanion}
                />
              }
            />
            <Route path="/" element={inboxPage} />
            <Route
              path="/repos/:owner/:repo/pulls"
              element={
                route.kind === 'not-found' ? (
                  <div className="empty-state">
                    <strong>Page not found</strong>
                    <Link to={inboxPath(repository, filter)}>Back to inbox</Link>
                  </div>
                ) : (
                  inboxPage
                )
              }
            />
            <Route
              path="/repos/:owner/:repo/pulls/:number"
              element={
                route.kind === 'not-found' ? (
                  <div className="empty-state">
                    <strong>Page not found</strong>
                    <Link to={inboxPath(repository, filter)}>Back to inbox</Link>
                  </div>
                ) : pull ? (
                  <ReviewWorkspace
                    key={pull.id}
                    pull={pull}
                    onUpdate={updatePull}
                    organization={preferences?.organization}
                    onReload={() => void reloadPull()}
                    reloading={reloading}
                    inboxUrl={inboxPath(repository, filter)}
                    reviewActions={
                      <PullReviewActions
                        pull={pull}
                        startCompanion="bob"
                        bobReview={bobReviews.get(pull.url)}
                        recommendation={recommendations.get(pull.url)}
                        onBobReplay={(review) => {
                          openBob(pull.url, review.sessionId)
                        }}
                        onReplay={(recommendation) => {
                          setLinusSelection(undefined)
                          setLinusReplay({
                            repository,
                            sessionId: recommendation.sessionId,
                            url: pull.url,
                          })
                        }}
                        reviewStarting={Boolean(reviewLaunch.starting)}
                        reviewStartDisabled={savedBob.loading}
                        onStartReview={(companion) => {
                          startReview(companion, pull.url)
                        }}
                      />
                    }
                    renderCompanion={({ draft, setDraft, ready, openReview, focusLine }) =>
                      bobReplayId && (
                        <BobCompanion
                          renderSessionCard={renderSessionCard}
                          key={`${pull.id}:${bobReplayId}`}
                          replaySessionId={bobReplayId}
                          onClose={closeBob}
                          onSessionUpdate={refreshLinus}
                          pull={pull}
                          draft={draft}
                          setDraft={setDraft}
                          ready={ready}
                          openReview={openReview}
                          focusLine={focusLine}
                        />
                      )
                    }
                    titlebarTarget={titlebarTarget}
                  />
                ) : (
                  <PullLoadingState
                    key={`${repository}:${route.kind === 'pull' ? route.number : 0}:${loading}`}
                    number={route.kind === 'pull' ? route.number : 0}
                    loading={loading}
                    error={pullError}
                    inboxUrl={inboxPath(repository, filter)}
                    onRetry={retryPull}
                  />
                )
              }
            />
            <Route
              path="*"
              element={
                <div className="empty-state">
                  <strong>Page not found</strong>
                  <Link to={inboxPath(repository, filter)}>Back to inbox</Link>
                </div>
              }
            />
          </Routes>
        </main>
        {repository &&
          route.kind !== 'sessions' &&
          (activeLinusReplay || linusSessionId || selectingForLinus) && (
            <LinusCompanion
              renderSessionCard={renderSessionCard}
              key={`${repository}:${activeLinusReplay ? 'replay' : linusSessionId}`}
              sessionId={activeLinusReplay ? undefined : linusSessionId}
              onClose={() => {
                setLinusReplay(undefined)
                setLinusSelection(undefined)
                reviewLaunch.closeLinus()
              }}
              repository={repository}
              pulls={myPulls}
              available={route.kind === 'inbox' && filter === 'mine'}
              preferences={preferences}
              currentPull={pull}
              replayRequest={activeLinusReplay}
              onSessionUpdate={refreshLinus}
              selection={{
                active: selectingForLinus,
                urls: selectedLinusUrls,
                onChoose: () => {
                  setLinusReplay(undefined)
                  setLinusSelection({ repository, urls: [] })
                  void navigate(inboxPath(repository, 'mine'))
                },
                onChange: (urls) => {
                  setLinusSelection({ repository, urls })
                },
                onCancel: () => {
                  setLinusSelection(undefined)
                },
              }}
            />
          )}
        {repository && gandalfRepository === repository && route.kind === 'inbox' && (
          <GandalfCompanion
            renderSessionCard={renderSessionCard}
            key={repository}
            repository={repository}
            pulls={
              inboxSections(myPulls).find((section) => section.id === 'conflicts')?.pulls ?? []
            }
            ready={Boolean(preferences?.organization)}
            onClose={closeGandalf}
            onComplete={refreshAfterGandalf}
          />
        )}
        <StackDialog
          url={stackTarget?.url}
          currentNumber={stackTarget?.number ?? 0}
          filter={filter}
          onClose={() => {
            setStackTarget(undefined)
          }}
        />
        <PullStatusDialog
          url={statusTarget?.url}
          section={statusTarget?.section}
          onClose={() => {
            setStatusTarget(undefined)
          }}
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
                openPull(url)
              }}
            >
              <Input
                autoFocus
                aria-label="Pull request URL"
                placeholder="https://github.com/owner/repo/pull/123"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value)
                }}
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
