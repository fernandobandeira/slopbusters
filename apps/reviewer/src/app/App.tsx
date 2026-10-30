import { AgentSessionCard } from '../features/agent-sessions/AgentSessionCard'
import { SessionsPage } from '../features/agent-sessions/SessionsPage'
import type { InboxPull, Repository } from '../../shared/domain/types'
import { GandalfCompanion } from '../features/gandalf/GandalfCompanion'
import type { GandalfTask } from '../../shared/domain/gandalf'
import { pullStatusGroup } from '../features/inbox/inboxStatus'
import { readInboxChips } from '../features/inbox/inboxChips'
import type { PullSelection } from '../features/inbox/SelectionBar'
import { PanelBatchPicker } from '../features/panel/PanelBatchPicker'
import { notifySettled } from '../features/panel/panelNotifications'
import { useActivePanels } from '../features/panel/useActivePanels'
import { MAX_PANEL_BATCH_PULLS } from '../../shared/domain/panel'
import { BobCompanion } from '../features/bob/BobCompanion'
import { PanelCompanion } from '../features/panel/PanelCompanion'
import { PullPanelActions } from './PullPanelActions'
import { usePanelReview } from './usePanelReview'
import { AppSidebar } from './AppSidebar'
import { InboxPullActions } from './InboxPullActions'
import { useReviewLaunch } from './useReviewLaunch'
import { AskLinusButton } from '../features/linus/AskLinusButton'
import { SplitCompanion } from '../features/split/SplitCompanion'
import type { LinusResult } from '../../shared/domain/linus'
import { PullReviewActions } from './PullReviewActions'
import { IssueRoute, IssuesRoute, LinkedTicketLink } from './IssueRoutes'
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
import { useRepositoryHistory } from '../features/inbox/useRepositoryHistory'
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
import { call, message } from '../lib/api'
import { inboxPulls } from '../features/inbox/inbox'
import { ReviewPage } from './ReviewPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { OrganizationSettings } from '../features/settings/OrganizationSettings'
import { TeammateSettings } from '../features/teammates/TeammateSettings'

import { StackDialog } from '../features/stacks/StackPanel'
import { PullStatusDialog } from '../features/pull-status/PullStatusDialog'
import { type PullStatusSection } from '../components/PullStatusIcons'

import { LinusCompanion } from '../features/linus/LinusCompanion'

import { useLinusRecommendations } from '../features/linus/useLinusRecommendations'
import type { LinusReplayRequest } from '../../shared/domain/linus'

const emptyRepositories: Repository[] = []
const emptyPulls: InboxPull[] = []

export function App() {
  const [titlebarTarget, setTitlebarTarget] = useState<HTMLDivElement | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const route = readRoute(location)
  const visitedRepository =
    route.kind === 'inbox' || route.kind === 'pull' || route.kind === 'sessions'
      ? route.repository
      : undefined
  const { recentRepositories, historyLoading, historyError } =
    useRepositoryHistory(visitedRepository)
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
  const [gandalf, setGandalf] = useState<{ repository: string; task: GandalfTask }>()
  const refreshAfterGandalf = useCallback(() => {
    setRefresh((value) => value + 1)
  }, [])
  const closeGandalf = useCallback(() => {
    setGandalf(undefined)
  }, [])
  const [selection, setSelection] = useState<{ repository: string; urls: string[] }>()
  const [split, setSplit] = useState<{ repository: string; id: string }>()
  const closeSplit = useCallback(() => {
    setSplit(undefined)
  }, [])
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
    target.searchParams.delete('panel')
    target.searchParams.set('bob', sessionId)
    void navigate(target.pathname + target.search)
  }
  function openPanel(url: string, sessionId: string) {
    const target = new URL(
      pull?.url === url ? location.pathname + location.search : reviewPath({ url, filter }),
      window.location.origin,
    )
    target.searchParams.delete('bob')
    target.searchParams.set('panel', sessionId)
    void navigate(target.pathname + target.search)
  }
  const reviewLaunch = useReviewLaunch({
    repository,
    restore: route.kind === 'inbox' || route.kind === 'pull',
    onError: setError,
  })
  async function askLinus(urls: string[]) {
    setLinusReplay(undefined)
    if (await reviewLaunch.start(urls)) setSelection(undefined)
  }
  function openSplit(id: string) {
    setSplit({ repository, id })
    setLinusReplay(undefined)
    reviewLaunch.closeLinus()
  }
  async function startSplit(result: LinusResult, linusSessionId: string) {
    setError('')
    try {
      const session = await call(routes.startSplit, {
        body: { repository, url: result.pull.url, linusSessionId },
      })
      refreshLinus()
      openSplit(session.id)
    } catch (cause) {
      setError(message(cause))
    }
  }
  function openGandalf(task: GandalfTask) {
    setGandalf({ repository, task })
    setSelection(undefined)
    setLinusReplay(undefined)
    reviewLaunch.closeLinus()
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
  const {
    preferences,
    preferencesError,
    saveOrganization,
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
  const panel = usePanelReview({
    repository,
    enabled: Boolean(repository) && (route.kind === 'inbox' || route.kind === 'pull'),
    refresh: refresh + linusRefresh,
  })
  const { inbox, inboxLoading, inboxError, inboxStatusLoading } = useInbox(repository, {
    filter,
    refresh,
    enabled: route.kind === 'inbox' && !historyLoading,
  })
  const activePanels = useActivePanels({
    repository,
    enabled: route.kind === 'inbox' || route.kind === 'pull',
    refresh,
    onSettled: (settled) => {
      panel.reload()
      notifySettled(settled, {
        titleFor: (url) => inbox?.pulls.find((item) => item.url === url)?.title,
        onOpen: (stopped) => {
          openPanel(stopped.url, stopped.sessionId)
        },
      })
    },
  })
  const displayError =
    error || historyError || inboxError || statusQuery.error || repositoryQuery.error
  useEffect(() => {
    if (historyLoading) return
    const initialRepository = repository || repositories[0]?.fullName
    if (location.pathname === '/' && initialRepository) {
      void navigate(inboxPath(initialRepository, filter), { replace: true })
    }
  }, [location.pathname, repository, repositories, filter, navigate, historyLoading])

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
  const chips = route.kind === 'inbox' ? readInboxChips(location.search) : []
  const selectedUrls =
    selection?.repository === repository
      ? selection.urls.filter((url) => inbox?.pulls.some((pr) => pr.url === url))
      : []
  const closeSelection = () => {
    setSelection(undefined)
  }
  const inboxSelection: PullSelection | undefined =
    selection?.repository === repository && route.kind === 'inbox'
      ? {
          purpose: 'review',
          urls: selectedUrls,
          max: MAX_PANEL_BATCH_PULLS,
          onChange: (urls) => {
            setSelection({ repository, urls })
          },
          onCancel: closeSelection,
          actions: (
            <>
              <AskLinusButton
                urls={selectedUrls}
                busy={reviewLaunch.starting}
                onStart={(urls) => void askLinus(urls)}
              />
              <PanelBatchPicker
                repository={repository}
                urls={selectedUrls}
                provider={preferences?.organization?.provider}
                onStarted={({ skipped }) => {
                  closeSelection()
                  activePanels.reload()
                  setError(skipped.map((item) => item.reason).join(' '))
                }}
              />
            </>
          ),
        }
      : undefined
  const inboxPage = (
    <InboxPage
      repository={repository}
      filter={filter}
      inbox={inbox}
      inboxLoading={inboxLoading}
      statusLoading={inboxStatusLoading}
      recommendationsError={savedLinus.error}
      bobReviewsError={savedBob.error}
      chips={chips}
      chipContext={{
        panelReviewed: (pr) =>
          Boolean(activePanels.panelFor(pr.url)) || panel.reviewFor(pr.url)?.headSha === pr.headSha,
      }}
      onChips={(next) => void navigate(inboxPath(repository, filter, next), { replace: true })}
      selection={inboxSelection}
      onSelect={() => {
        setSelection({ repository, urls: [] })
      }}
      onFilter={(next) => void navigate(inboxPath(repository, next, chips))}
      onResolveConflicts={() => {
        openGandalf('conflicts')
      }}
      onFixCi={() => {
        openGandalf('ci')
      }}
      renderPullActions={(pr) => (
        <InboxPullActions
          pull={pr}
          recommendation={recommendations.get(pr.url)}
          bobReview={bobReviews.get(pr.url)}
          onBobReplay={(review) => {
            openBob(pr.url, review.sessionId)
          }}
          panelReview={panel.reviewFor(pr.url)}
          onPanelReplay={(review) => {
            openPanel(pr.url, review.sessionId)
          }}
          activePanel={activePanels.panelFor(pr.url)}
          onActivePanel={(active) => {
            openPanel(pr.url, active.sessionId)
          }}
          onReplay={(recommendation) => {
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
                    : route.kind === 'issues' || route.kind === 'issue'
                      ? 'Issues'
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
            issuesView={
              route.kind === 'issues' ? route.view : route.kind === 'issue' ? 'open' : undefined
            }
            onFilter={(next) => {
              void navigate(inboxPath(repository, next, chips))
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
                  status={status}
                  onSave={saveOrganization}
                  teammates={<TeammateSettings />}
                />
              }
            />
            <Route
              path="/issues"
              element={<IssuesRoute view={route.kind === 'issues' ? route.view : 'assigned'} />}
            />
            <Route
              path="/issues/:identifier"
              element={
                route.kind === 'issue' ? (
                  <IssueRoute identifier={route.identifier} repository={repository} />
                ) : (
                  <div className="empty-state">
                    <strong>Page not found</strong>
                  </div>
                )
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
                  <ReviewPage
                    key={pull.id}
                    pull={pull}
                    onUpdate={updatePull}
                    organization={preferences?.organization}
                    onReload={() => void reloadPull()}
                    reloading={reloading}
                    inboxUrl={inboxPath(repository, filter)}
                    reviewActions={
                      <>
                        <LinkedTicketLink url={pull.url} />
                        <PullReviewActions
                          pull={pull}
                          bobReview={bobReviews.get(pull.url)}
                          recommendation={recommendations.get(pull.url)}
                          onBobReplay={(review) => {
                            openBob(pull.url, review.sessionId)
                          }}
                          onReplay={(recommendation) => {
                            setLinusReplay({
                              repository,
                              sessionId: recommendation.sessionId,
                              url: pull.url,
                            })
                          }}
                        />
                        <PullPanelActions
                          repository={repository}
                          pull={pull}
                          provider={preferences?.organization?.provider}
                          review={panel.reviewFor(pull.url)}
                          onOpen={panel.open}
                          onSettled={panel.reload}
                          asking={panel.asking}
                          onDismissAsk={panel.dismissAsk}
                        />
                      </>
                    }
                    renderCompanion={({ draft, setDraft, ready, openReview, focusLine }) =>
                      panel.sessionId ? (
                        <PanelCompanion
                          renderSessionCard={renderSessionCard}
                          key={`${pull.id}:${panel.sessionId}`}
                          sessionId={panel.sessionId}
                          onOpen={panel.open}
                          onClose={panel.close}
                          onSessionUpdate={panel.reload}
                          pull={pull}
                          draft={draft}
                          setDraft={setDraft}
                          ready={ready}
                          openReview={openReview}
                          focusLine={focusLine}
                        />
                      ) : (
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
        {repository && route.kind !== 'sessions' && (activeLinusReplay || linusSessionId) && (
          <LinusCompanion
            renderSessionCard={renderSessionCard}
            key={`${repository}:${activeLinusReplay ? 'replay' : linusSessionId}`}
            sessionId={activeLinusReplay ? undefined : linusSessionId}
            onClose={() => {
              setLinusReplay(undefined)
              reviewLaunch.closeLinus()
            }}
            repository={repository}
            pulls={inbox?.pulls ?? emptyPulls}
            currentPull={pull}
            replayRequest={activeLinusReplay}
            onSessionUpdate={refreshLinus}
            onSessionStarted={(id) => {
              setLinusReplay(undefined)
              reviewLaunch.open(id)
            }}
            onOpenPanel={(url, id) => {
              activePanels.reload()
              openPanel(url, id)
            }}
            onSplit={(result, linusSessionId) => void startSplit(result, linusSessionId)}
            onOpenSplit={openSplit}
          />
        )}
        {repository && split?.repository === repository && route.kind !== 'sessions' && (
          <SplitCompanion
            key={split.id}
            sessionId={split.id}
            renderSessionCard={renderSessionCard}
            onClose={closeSplit}
            onSettled={refreshAfterGandalf}
          />
        )}
        {repository && gandalf?.repository === repository && route.kind === 'inbox' && (
          <GandalfCompanion
            renderSessionCard={renderSessionCard}
            key={`${repository}:${gandalf.task}`}
            repository={repository}
            task={gandalf.task}
            pulls={myPulls.filter(
              (pr) => pullStatusGroup(pr) === (gandalf.task === 'ci' ? 'failing-ci' : 'conflicts'),
            )}
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
