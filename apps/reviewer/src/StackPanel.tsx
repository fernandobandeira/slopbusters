import {
  Circle,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Layers,
  RotateCw,
  X,
} from 'lucide-react'
import { Link } from 'react-router'
import { useEffect, useId, useRef, useState } from 'react'
import type { PullStack, PullStackResult, StackPull } from '../shared/stacks'
import type { InboxFilter } from './inbox'
import { reviewPath } from './routes'
import { api, message } from './api'
import { PullStatusPanel, readinessPresentation } from './PullStatusPanel'
import { PullStatusIcons, type PullStatusSection } from './PullStatusIcons'
import { Button } from './vendor/t3/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from './vendor/t3/components/ui/dialog'
import './stacks.css'

interface StackPanelProps {
  stack: PullStack
  currentNumber: number
  filter: InboxFilter
  onOpenLayer?: () => void
}

function pullPresentation(pull: StackPull) {
  if (pull.state === 'merged') return { Icon: GitMerge, label: 'Merged', tone: 'merged' }
  if (pull.state === 'closed')
    return { Icon: GitPullRequestClosed, label: 'Closed', tone: 'closed' }
  if (pull.isDraft) return { Icon: GitPullRequestDraft, label: 'Draft', tone: 'draft' }
  return { Icon: GitPullRequest, label: 'Open', tone: 'open' }
}

export function StackPanel({ stack, currentNumber, filter, onOpenLayer }: StackPanelProps) {
  const layers = [...stack.items].reverse()
  const [expanded, setExpanded] = useState<{ key: string; section: PullStatusSection }>()
  const panelId = useId()
  return (
    <div className="stack-panel">
      {stack.source === 'derived' && <p className="stack-derived">Based on branch dependencies.</p>}
      <ol className="stack-chain" aria-label="Pull request stack, top to base">
        {layers.map((pull) => {
          const current = pull.number === currentNumber
          const { Icon, label, tone } = pullPresentation(pull)
          const readinessTone = pull.status ? readinessPresentation(pull.status).tone : undefined
          const key = `${pull.repository}#${pull.number}`
          const activeSection = expanded?.key === key ? expanded.section : undefined
          const detailsId = `${panelId}-${pull.number}`
          return (
            <li key={key} className={`stack-layer ${current ? 'stack-layer-current' : ''}`}>
              <div className="stack-layer-row">
                <Link
                  to={reviewPath({ url: pull.url, filter })}
                  className="stack-layer-link"
                  aria-current={current ? 'page' : undefined}
                  onClick={onOpenLayer}
                >
                  <span
                    className={`stack-node ${readinessTone ? `pull-tone-${readinessTone}` : `stack-state-${tone}`}`}
                    title={`${label} pull request`}
                    role="img"
                    aria-label={`${label} pull request`}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="stack-layer-content">
                    <span className="stack-layer-title" title={pull.title}>
                      {pull.title}
                    </span>
                    <span className="stack-pr-number">#{pull.number}</span>
                  </span>
                </Link>
                {pull.status && (
                  <PullStatusIcons
                    status={pull.status}
                    inline
                    expandedSection={activeSection}
                    controlsId={detailsId}
                    onSelect={(section) =>
                      setExpanded((previous) =>
                        previous?.key === key && previous.section === section
                          ? undefined
                          : { key, section },
                      )
                    }
                  />
                )}
              </div>
              {pull.status && activeSection && (
                <div className="stack-layer-readiness" id={detailsId}>
                  <button
                    type="button"
                    className="stack-status-close"
                    aria-label="Hide status details"
                    onClick={() => setExpanded(undefined)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                  <PullStatusPanel
                    status={pull.status}
                    compact
                    section={activeSection}
                    pullUrl={pull.url}
                  />
                </div>
              )}
            </li>
          )
        })}
        <li className="stack-base">
          <span className="stack-node">
            <Circle size={12} aria-hidden="true" />
          </span>
          <code title={`Base branch: ${stack.baseBranch}`}>{stack.baseBranch}</code>
          <span className="stack-base-label">Base</span>
        </li>
      </ol>
      {stack.warnings.map((warning) => (
        <p className="stack-warning" role="status" key={warning}>
          {warning}
        </p>
      ))}
    </div>
  )
}

interface StackDialogProps {
  url: string | undefined
  onClose: () => void
  stack?: PullStack
  currentNumber: number
  filter: InboxFilter
}

interface StackQuery {
  url: string
  result?: PullStackResult
  error?: string
}
export function StackDialog(props: StackDialogProps) {
  return <StackDialogView key={props.url ?? 'closed'} {...props} />
}

function StackDialogView({
  url,
  onClose,
  stack: suppliedStack,
  currentNumber,
  filter,
}: StackDialogProps) {
  const [query, setQuery] = useState<StackQuery | undefined>(() =>
    url && suppliedStack
      ? { url, result: { stack: suppliedStack, warnings: suppliedStack.warnings } }
      : undefined,
  )
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useRef<() => void>(() => {})

  useEffect(() => {
    if (!url) return
    let active = true
    let inFlight = false
    let controller: AbortController | undefined
    const load = async () => {
      if (!active || inFlight) return
      inFlight = true
      controller = new AbortController()
      setRefreshing(true)
      try {
        const result = await api<PullStackResult>(
          `/stack?${new URLSearchParams({ url, refresh: '1' })}`,
          {
            signal: controller.signal,
          },
        )
        if (!active) return
        setQuery((previous) => {
          if (!result.stack && result.warnings.length && previous?.result?.stack)
            return {
              ...previous,
              error: `Could not refresh the stack. ${result.warnings.join(' ')}`,
            }
          return { url, result }
        })
      } catch (cause: unknown) {
        if (active && !controller.signal.aborted)
          setQuery((previous) => ({
            url,
            result: previous?.url === url ? previous.result : undefined,
            error: message(cause),
          }))
      } finally {
        inFlight = false
        if (active) setRefreshing(false)
      }
    }
    refresh.current = () => {
      void load()
    }
    void load()
    const visibleRefresh = () => {
      if (document.visibilityState === 'visible') void load()
    }
    const interval = window.setInterval(visibleRefresh, 30_000)
    window.addEventListener('focus', visibleRefresh)
    window.addEventListener('online', visibleRefresh)
    document.addEventListener('visibilitychange', visibleRefresh)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(interval)
      window.removeEventListener('focus', visibleRefresh)
      window.removeEventListener('online', visibleRefresh)
      document.removeEventListener('visibilitychange', visibleRefresh)
      refresh.current = () => {}
    }
  }, [url])

  const currentQuery = query?.url === url ? query : undefined
  const result = currentQuery?.result
  const stack = result?.stack
  const error = currentQuery?.error
  const loading = Boolean(url && !result && !error)

  return (
    <Dialog
      open={Boolean(url)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPopup className="stack-dialog">
        <DialogHeader>
          <div className="stack-dialog-header-row">
            <DialogTitle className="stack-dialog-title">
              <Layers size={17} aria-hidden="true" />
              {stack?.number ? `Stack #${stack.number}` : 'Pull request stack'}
            </DialogTitle>
            <div className="stack-dialog-tools">
              <Button
                size="xs"
                variant="ghost"
                disabled={refreshing}
                onClick={() => refresh.current()}
              >
                <RotateCw size={12} className={refreshing ? 'animate-spin' : undefined} />
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
          </div>
          <DialogDescription>
            {stack
              ? `${stack.size} pull requests, from the top of the stack to ${stack.baseBranch}.`
              : 'Review the pull requests that depend on one another.'}
          </DialogDescription>
        </DialogHeader>
        <div className="stack-dialog-body">
          {loading && (
            <p className="stack-message" role="status">
              Loading stack…
            </p>
          )}
          {error && (
            <div className="stack-retry">
              <p className="stack-warning" role="alert">
                {stack ? 'Showing the last stack result. ' : ''}
                {error}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={refreshing}
                onClick={() => refresh.current()}
              >
                Try again
              </Button>
            </div>
          )}
          {stack && (
            <StackPanel
              stack={stack}
              currentNumber={currentNumber}
              filter={filter}
              onOpenLayer={onClose}
            />
          )}
          {!loading && !error && !stack && (
            <p className="stack-message">No stack is available for this pull request.</p>
          )}
          {!stack &&
            result?.warnings.map((warning) => (
              <p className="stack-warning" role="status" key={warning}>
                {warning}
              </p>
            ))}
        </div>
      </DialogPopup>
    </Dialog>
  )
}
