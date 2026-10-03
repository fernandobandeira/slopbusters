import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { Link, useSearchParams } from 'react-router'
import { readReviewView, updateReviewView, type ReviewView } from './routes'
import {
  Check,
  Copy,
  MessageSquare,
  Plus,
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  RotateCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { Button } from './vendor/t3/components/ui/button'
import { Badge } from './vendor/t3/components/ui/badge'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './vendor/t3/components/ui/dialog'
import { StyledDiffCodeView } from './vendor/t3/components/diffs/StyledDiffCodeView'
import { api, message } from './api'
import { diffItems } from './diffItems'
import { displayPullWithContext, CONTEXT_STEP, MAX_CONTEXT } from './displayContext'
import { useFileContext } from './useFileContext'
import { SourceContextDialog } from './SourceContextDialog'
import { annotateDiscussions, discussionGroup, type LineDiscussion } from './discussions'
import { InlineDiscussion, ThreadDiscussion } from './InlineDiscussion'
import { DiscussionsTray } from './DiscussionsTray'
import { CompactReviewHeader } from './CompactReviewHeader'
import { OrganizationEmptyState } from './OrganizationEmptyState'
import { useReviewDraft } from './useReviewDraft'
import { usePullUpdates } from './usePullUpdates'
import { usePullStack } from './usePullStack'
import { usePullStatus } from './usePullStatus'
import { PullStatusDialog } from './PullStatusDialog'
import type { PullStatusSection } from './PullStatusIcons'
import { PullDescription } from './PullDescription'
import { StackDialog } from './StackPanel'
import { readRoute } from './routes'
import {
  groupIsViewed,
  nextUnreviewedGroup,
  reviewedHunkIds,
  toggleViewedSections,
} from './reviewProgress'
import { useReviewerTheme } from './ThemeProvider'
import { clearSubmittedFeedback, exportFeedback, groupChangeTotals } from '../shared/review'
import { pullHasUpdates } from '../shared/updates'
import {
  DiffSide,
  Provider,
  ReviewEvent,
  type AppStatus,
  type DraftComment,
  type PullRequest,
  type PullDiscussions,
  type ReviewThread,
} from '../shared/types'

interface Props {
  pull: PullRequest
  onUpdate: (pull: PullRequest) => void
  status?: AppStatus
  onReload: () => void
  reloading: boolean
  inboxUrl: string
  titlebarTarget?: HTMLElement | null
}
const eventLabels: Record<ReviewEvent, string> = {
  COMMENT: 'Comment',
  REQUEST_CHANGES: 'Request changes',
  APPROVE: 'Approve',
}

export function ReviewWorkspace({
  pull,
  onUpdate,
  status,
  onReload,
  reloading,
  inboxUrl,
  titlebarTarget,
}: Props) {
  const { draft, setDraft, ready: draftReady, error: storageError, flush } = useReviewDraft(pull)
  const updates = usePullUpdates(pull)
  const { stack, summary: stackSummary } = usePullStack(pull)
  const [stackOpen, setStackOpen] = useState(false)
  const pullStatus = usePullStatus(pull.url, pull.id)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusSection, setStatusSection] = useState<PullStatusSection>()
  const inboxRoute = readRoute({
    pathname: window.location.pathname,
    search: window.location.search,
  })
  const inboxFilter = inboxRoute.kind === 'not-found' ? 'mine' : inboxRoute.filter
  const { themeId, resolvedTheme } = useReviewerTheme()
  const [collapseOverrides, setCollapseOverrides] = useState(() => new Map<string, boolean>())
  const fileContext = useFileContext(pull.id)
  const loadFileContext = fileContext.load
  const [contextLines, setContextLines] = useState(() => new Map<string, number>())
  const [sourceFileId, setSourceFileId] = useState<string>()
  const [searchParams, setSearchParams] = useSearchParams()
  const unviewedOnly = searchParams.get('unviewed') === '1'
  const view = readReviewView(searchParams)
  const grouped = pull.groupingSource !== 'files'
  const { split } = view
  function changeView(changes: Partial<ReviewView>) {
    const next = updateReviewView(searchParams, changes)
    if (next.toString() !== searchParams.toString()) setSearchParams(next)
  }
  const [discussionTray, setDiscussionTray] = useState(false)
  const [provider, setProvider] = useState(() =>
    pull.groupingSource === 'files' ? Provider.codex : pull.groupingSource,
  )
  const [showRegenerate, setShowRegenerate] = useState(false)
  const [job, setJob] = useState<string>()
  const [organizing, setOrganizing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editor, setEditor] = useState<Omit<DraftComment, 'body'> | null>(null)
  const [body, setBody] = useState('')
  const viewerRef = useRef<CodeViewHandle<LineDiscussion, undefined>>(null)
  const [discussions, setDiscussions] = useState<PullDiscussions>()
  const [discussionError, setDiscussionError] = useState('')
  const [submitOpen, setSubmitOpen] = useState(false)
  const [event, setEvent] = useState(ReviewEvent.comment)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<string>()
  const [exportOpen, setExportOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const hasFeedback = draft.comments.length > 0 || draft.summary.trim().length > 0
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const groups = grouped ? pull.groups : []
  const selected =
    groups.find((group) => group.id === view.groupId) ??
    groups.find((group) => !groupIsViewed(group, draft, pull)) ??
    groups[0]
  const viewedHunks = reviewedHunkIds(pull, draft)
  const selectedHunks = pull.files
    .flatMap((file) => file.hunks)
    .filter((hunk) => selected?.hunkIds.includes(hunk.id))
  const viewedCount = selectedHunks.filter((hunk) => viewedHunks.has(hunk.id)).length
  const visibleGroup = useMemo(
    () =>
      selected && {
        ...selected,
        hunkIds: unviewedOnly
          ? selected.hunkIds.filter((id) => !(draft.viewedHunkIds ?? []).includes(id))
          : selected.hunkIds,
      },
    [selected, unviewedOnly, draft.viewedHunkIds],
  )
  function sectionIds(fileId: string) {
    return (
      pull.files
        .find((file) => file.id === fileId)
        ?.hunks.filter((hunk) => selected?.hunkIds.includes(hunk.id))
        .map((hunk) => hunk.id) ?? []
    )
  }
  function fileSectionsViewed(fileId: string) {
    const sections = sectionIds(fileId)
    return sections.length > 0 && sections.every((id) => viewedHunks.has(id))
  }
  const displayPull = useMemo(
    () => displayPullWithContext(pull, fileContext.contents, contextLines),
    [pull, fileContext.contents, contextLines],
  )
  useEffect(() => {
    for (const fileId of visibleGroup?.fileIds ?? []) void loadFileContext(fileId).catch(() => {})
  }, [visibleGroup, loadFileContext])
  const items = useMemo(() => {
    return visibleGroup
      ? diffItems(displayPull, visibleGroup, fileContext.contents).map((item) => {
          const ids =
            pull.files
              .find((file) => file.id === item.id)
              ?.hunks.filter((hunk) => selected?.hunkIds.includes(hunk.id))
              .map((hunk) => hunk.id) ?? []
          const viewed =
            ids.length > 0 && ids.every((id) => (draft.viewedHunkIds ?? []).includes(id))
          return {
            ...item,
            collapsed: collapseOverrides.get(`${selected?.id}/${item.id}`) ?? viewed,
          }
        })
      : []
  }, [
    pull,
    displayPull,
    fileContext.contents,
    visibleGroup,
    selected,
    collapseOverrides,
    draft.viewedHunkIds,
  ])
  const annotated = useMemo(
    () =>
      annotateDiscussions({
        items,
        pull,
        discussions,
        comments: draft.comments,
        editor,
      }),
    [items, pull, discussions, draft.comments, editor],
  )
  useEffect(() => {
    const controller = new AbortController()
    void api<PullDiscussions>(`/pulls/${pull.id}/threads`, { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setDiscussions(value)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDiscussionError(message(error))
      })
    return () => controller.abort()
  }, [pull.id])
  useEffect(() => {
    if (!editor) return
    const file = pull.files.find((file) => file.path === editor.path)
    if (file)
      viewerRef.current?.scrollTo({
        type: 'line',
        id: file.id,
        lineNumber: editor.line,
        side: editor.side === DiffSide.left ? 'deletions' : 'additions',
        align: 'nearest',
      })
  }, [editor, selected?.id, pull.files])
  async function refreshDiscussions() {
    const value = await api<PullDiscussions>(`/pulls/${pull.id}/threads`)
    setDiscussions(value)
    setDiscussionError('')
  }
  async function postReply(thread: ReviewThread, body: string) {
    await api(`/pulls/${pull.id}/threads/${encodeURIComponent(thread.id)}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
    setNotice('Reply posted to GitHub.')
    void refreshDiscussions().catch((error) => setDiscussionError(message(error)))
  }
  function toggleFile(fileId: string) {
    if (!selected) return
    const nextDraft = toggleViewedSections(pull, draft, sectionIds(fileId))
    const markingViewed = sectionIds(fileId).every((id) => nextDraft.viewedHunkIds?.includes(id))
    setFileCollapsed(fileId, markingViewed)
    setDraft(nextDraft)
    if (markingViewed && groupIsViewed(selected, nextDraft, pull)) {
      const next = nextUnreviewedGroup(pull.groups, selected.id, nextDraft, pull)
      if (next) changeView({ groupId: next.id })
    }
  }
  function setFileCollapsed(fileId: string, collapsed: boolean, groupId = selected?.id) {
    setCollapseOverrides((previous) => {
      const next = new Map(previous)
      next.set(`${groupId}/${fileId}`, collapsed)
      return next
    })
  }
  async function reloadReview() {
    try {
      await flush()
      onReload()
    } catch (error) {
      setError(message(error))
    }
  }
  function editComment(comment: DraftComment) {
    const file = pull.files.find((file) => file.path === comment.path)
    if (!file) return
    const group = discussionGroup({
      pull,
      path: comment.path,
      line: comment.line,
      side: comment.side,
    })
    if (!group) {
      setNotice('Organize changes before editing line comments.')
      return
    }
    setFileCollapsed(file.id, false, group.id)
    changeView({ groupId: group.id })
    setEditor(comment)
    setBody(comment.body)
  }
  function deleteComment(comment: DraftComment) {
    setDraft((previous) => ({
      ...previous,
      comments: previous.comments.filter((item) => item.id !== comment.id),
    }))
  }
  const transfers = pull.transfers.filter((transfer) =>
    selected?.fileIds.some(
      (id) =>
        pull.files.find((file) => file.id === id)?.path === transfer.toPath ||
        pull.files.find((file) => file.id === id)?.path === transfer.fromPath,
    ),
  )

  useEffect(() => {
    if (!job) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await api<{ status: string; error?: string }>(`/jobs/${job}`)
        if (!active) return
        if (result.status === 'complete') {
          const updated = await api<PullRequest>(`/pulls/${pull.id}`)
          if (active) {
            onUpdate(updated)
            setJob(undefined)
            setOrganizing(false)
            setShowRegenerate(false)
          }
        } else if (result.status === 'failed') {
          setError(result.error ?? 'Organization failed.')
          setJob(undefined)
          setOrganizing(false)
        } else timer = setTimeout(() => void poll(), 1500)
      } catch (error) {
        if (active) {
          setError(message(error))
          setJob(undefined)
          setOrganizing(false)
        }
      }
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [job, pull.id, onUpdate])

  async function organize() {
    setError('')
    setNotice('')
    setOrganizing(true)
    try {
      const result = await api<{ id: string }>(`/pulls/${pull.id}/organize`, {
        method: 'POST',
        body: JSON.stringify({ provider }),
      })
      setJob(result.id)
      changeView({ groupId: undefined })
    } catch (error) {
      setError(message(error))
      setOrganizing(false)
    }
  }
  function addComment(location: { path: string; line: number; side: DiffSide; code?: string }) {
    if (!selected) return
    setBody('')
    setEditor({
      id: crypto.randomUUID(),
      headSha: pull.headSha,
      ...location,
    })
  }
  function commentOnLine(params: { fileId: string; line: number; side: DiffSide }) {
    const file = pull.files.find((file) => file.id === params.fileId)
    const source = file?.hunks
      .flatMap((hunk) => hunk.lines)
      .find((line) =>
        params.side === DiffSide.left ? line.oldLine === params.line : line.newLine === params.line,
      )
    if (file && source)
      addComment({ path: file.path, line: params.line, side: params.side, code: source.text })
  }
  function saveComment() {
    if (!editor || !body.trim()) return
    const comment = { ...editor, body: body.trim() }
    setDraft((previous) => ({
      ...previous,
      comments: [...previous.comments.filter((item) => item.id !== comment.id), comment],
    }))
    setEditor(null)
    setSubmitted(undefined)
  }
  async function copyFeedback() {
    try {
      await navigator.clipboard.writeText(exportFeedback(pull, draft))
      setCopied(true)
    } catch {
      setExportOpen(true)
    }
  }
  async function submit() {
    if (submitting || submitted) return
    setSubmitting(true)
    setError('')
    const submittedDraft = draft
    try {
      await flush()
      const result = await api<{ url: string }>(`/pulls/${pull.id}/reviews`, {
        method: 'POST',
        body: JSON.stringify({ draft: submittedDraft, event }),
      })
      let hasRemainingFeedback = false
      setDraft((previous) => {
        const remaining = clearSubmittedFeedback(previous, submittedDraft)
        hasRemainingFeedback = remaining.comments.length > 0 || remaining.summary.trim().length > 0
        return remaining
      })
      setSubmitted(hasRemainingFeedback ? undefined : result.url)
      setSubmitOpen(false)
      await flush()
      setNotice('Review submitted to GitHub. Comments are now part of the discussion.')
      void refreshDiscussions().catch((error) => setDiscussionError(message(error)))
    } catch (error) {
      setError(
        `${message(error)} If the connection was interrupted, check GitHub before trying again.`,
      )
    } finally {
      setSubmitting(false)
    }
  }
  if (!draftReady)
    return (
      <div className="empty-state" role={storageError ? 'alert' : 'status'}>
        <strong>{storageError ?? 'Loading saved review…'}</strong>
        {storageError && (
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        )}
      </div>
    )
  const reviewHeader = (
    <div className="review-chrome">
      {!grouped && (
        <Link className="back-to-inbox organization-back" to={inboxUrl}>
          <ArrowLeft size={14} />
          Back to inbox
        </Link>
      )}
      <CompactReviewHeader
        pull={pull}
        onDescription={() => setDescriptionOpen(true)}
        onReload={() => void reloadReview()}
        hasUpdates={
          updates.hasUpdates ||
          Boolean(pullStatus.status && pullHasUpdates(pull, pullStatus.status))
        }
        updateCheckError={updates.error}
        stack={stackSummary}
        onStack={() => setStackOpen(true)}
        status={pullStatus.status}
        statusError={pullStatus.error}
        onStatus={(section) => {
          setStatusSection(section)
          setStatusOpen(true)
        }}
        reloading={reloading}
        organizing={organizing || submitting}
      />
      {grouped && (
        <div className="review-toolbar">
          {groups.length > 0 && (
            <Button size="xs" variant="ghost" onClick={() => changeView({ split: !split })}>
              {split ? 'Unified' : 'Split'}
            </Button>
          )}
          {groups.length > 0 && (
            <Button
              size="xs"
              variant={unviewedOnly ? 'secondary' : 'ghost'}
              aria-pressed={unviewedOnly}
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                if (unviewedOnly) next.delete('unviewed')
                else next.set('unviewed', '1')
                setSearchParams(next)
              }}
            >
              {unviewedOnly ? 'Show all diffs' : 'Unviewed only'}
            </Button>
          )}
          <span className="push-right" />
          <Button
            size="sm"
            variant={discussionTray ? 'secondary' : 'ghost'}
            onClick={() => {
              setDiscussionTray(!discussionTray)
            }}
          >
            <MessageSquare size={14} />
            Discussions {discussions ? discussions.threads.length + draft.comments.length : '…'}
          </Button>
          {hasFeedback && (
            <Button
              className="copy-feedback"
              size="sm"
              variant="outline"
              disabled={copied}
              aria-live="polite"
              onClick={() => void copyFeedback()}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy feedback'}
            </Button>
          )}
          <Button
            size="sm"
            disabled={Boolean(submitted)}
            onClick={() => {
              setError('')
              setSubmitOpen(true)
            }}
          >
            {submitted ? 'Submitted' : 'Submit review'}
          </Button>
        </div>
      )}
    </div>
  )
  return (
    <div className="review-workspace">
      {grouped && (
        <aside className="group-sidebar" aria-label="Review navigation">
          <div className="review-navigation">
            <Link
              className="back-to-inbox"
              to={inboxUrl}
              onClick={(event) => {
                if (submitting) {
                  event.preventDefault()
                  setNotice('Wait for your review to finish submitting before leaving.')
                }
              }}
            >
              <ArrowLeft size={14} />
              Back to inbox
            </Link>
            {groups.length > 0 && (
              <div className="group-navigation-title">
                <span>Groups</span>
                <button
                  className="regenerate-icon"
                  aria-label="Regenerate groups"
                  title="Regenerate groups"
                  aria-expanded={showRegenerate}
                  disabled={organizing}
                  onClick={() => setShowRegenerate((previous) => !previous)}
                >
                  <RotateCw size={13} className={organizing ? 'animate-spin' : undefined} />
                </button>
              </div>
            )}
            {(showRegenerate || organizing) && (
              <div className="organize-controls">
                <select
                  aria-label="Coding provider"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as Provider)}
                >
                  <option value={Provider.codex} disabled={status && !status.codex.available}>
                    Codex
                  </option>
                  <option value={Provider.claude} disabled={status && !status.claude.available}>
                    Claude Code
                  </option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={organizing || (status && !status[provider].available)}
                  onClick={() => void organize()}
                >
                  {organizing ? (
                    <LoaderCircle size={13} className="animate-spin" />
                  ) : (
                    <Plus size={13} />
                  )}
                  {organizing ? 'Organizing…' : 'Regenerate'}
                </Button>
                {grouped && !organizing && (
                  <Button size="xs" variant="ghost" onClick={() => setShowRegenerate(false)}>
                    Cancel
                  </Button>
                )}
                {job && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() =>
                      void api(`/jobs/${job}`, { method: 'DELETE' }).catch((error) =>
                        setError(message(error)),
                      )
                    }
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="group-list">
            {groups.map((group) => {
              const done = groupIsViewed(group, draft, pull)
              const totals = groupChangeTotals(pull, group)
              return (
                <button
                  className={`group-row ${selected?.id === group.id ? 'selected' : ''}`}
                  data-reviewed={done ? true : undefined}
                  key={group.id}
                  onClick={() => changeView({ groupId: group.id })}
                >
                  <div className="group-row-top">
                    {done ? (
                      <Check size={13} className="green group-viewed" aria-label="Viewed" />
                    ) : (
                      <span className={`priority ${group.priority.toLowerCase()}`}>
                        {group.priority}
                      </span>
                    )}
                    <strong>{group.title}</strong>
                  </div>
                  <span className="group-change-stats muted">
                    <span>
                      {group.fileIds.length} {group.fileIds.length === 1 ? 'file' : 'files'}
                    </span>
                    <span className="green">+{totals.additions}</span>
                    <span className="red">−{totals.deletions}</span>
                  </span>
                </button>
              )
            })}
            {grouped && !groups.length && (
              <p className="empty-small muted">No changes to review.</p>
            )}
          </div>
        </aside>
      )}
      <div className="review-content">
        {titlebarTarget ? createPortal(reviewHeader, titlebarTarget) : reviewHeader}
        {storageError && (
          <div className="error-banner" role="alert">
            {storageError}
          </div>
        )}
        {(error || notice) && (
          <div
            role={error ? 'alert' : 'status'}
            className={error ? 'error-banner' : 'notice-banner'}
          >
            {error || notice}
            {submitted && (
              <a href={submitted} target="_blank" rel="noreferrer">
                View review
              </a>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setError('')
                setNotice('')
              }}
            >
              Dismiss
            </Button>
          </div>
        )}
        {discussionError && (
          <div className="warning-banner" role="alert">
            Could not load GitHub discussions: {discussionError}
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void refreshDiscussions().catch((error) => setDiscussionError(message(error)))
              }
            >
              Retry
            </Button>
          </div>
        )}
        {discussions &&
          (discussions.headSha !== pull.headSha || discussions.baseSha !== pull.baseSha) && (
            <div className="warning-banner">
              GitHub discussions belong to a newer revision. Reload the PR to see their current line
              locations.
            </div>
          )}
        {selectedHunks.length > 0 && (
          <div className="review-progress-note" role="status">
            {viewedCount} of {selectedHunks.length} diff sections viewed in this group.
          </div>
        )}
        {pull.warnings.map((warning) => (
          <div className="warning-banner" key={warning}>
            {warning}
          </div>
        ))}
        <div className="review-body">
          {!grouped ? (
            <OrganizationEmptyState
              provider={provider}
              status={status}
              organizing={organizing}
              onProviderChange={setProvider}
              onOrganize={() => void organize()}
              onCancel={
                job
                  ? () => {
                      void api(`/jobs/${job}`, { method: 'DELETE' }).catch((error) =>
                        setError(message(error)),
                      )
                    }
                  : undefined
              }
            />
          ) : (
            <section className="code-panel" aria-label="Code changes">
              {selected ? (
                <>
                  {transfers.length > 0 && (
                    <div className="transfers">
                      {transfers.map((transfer) => (
                        <details key={transfer.id}>
                          <summary>
                            <Badge variant={transfer.kind === 'moved' ? 'info' : 'secondary'}>
                              {transfer.kind}
                            </Badge>
                            <code>
                              {transfer.fromPath}:{transfer.fromLine}
                            </code>
                            <ArrowRight size={12} />
                            <code>
                              {transfer.toPath}:{transfer.toLine}
                            </code>
                            <span className="muted">{transfer.lineCount} unchanged lines</span>
                          </summary>
                          <pre>{transfer.text}</pre>
                        </details>
                      ))}
                    </div>
                  )}
                  {items.length ? (
                    <StyledDiffCodeView
                      key={selected.id}
                      className="viewer"
                      viewerRef={viewerRef}
                      items={annotated.items}
                      renderHeaderPrefix={(item) => (
                        <button
                          type="button"
                          className="file-collapse-toggle"
                          aria-label={`${item.collapsed ? 'Expand' : 'Collapse'} ${item.type === 'diff' ? item.fileDiff.name : item.file.name}`}
                          aria-expanded={!item.collapsed}
                          title={item.collapsed ? 'Expand file' : 'Collapse file'}
                          onClick={() => setFileCollapsed(item.id, !item.collapsed)}
                        >
                          {item.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                      renderHeaderMetadata={(item) => {
                        const file = pull.files.find((file) => file.id === item.id)
                        return file ? (
                          <div className="file-context-actions">
                            <button
                              type="button"
                              disabled={
                                fileContext.isLoading(file.id) ||
                                file.coverage !== 'complete' ||
                                (contextLines.get(file.id) ?? 0) >= MAX_CONTEXT
                              }
                              title={
                                fileContext.error(file.id) ??
                                'Expand unchanged lines around these sections'
                              }
                              onClick={() =>
                                void fileContext
                                  .load(file.id)
                                  .then(() =>
                                    setContextLines((values) =>
                                      new Map(values).set(
                                        file.id,
                                        Math.min(
                                          MAX_CONTEXT,
                                          (values.get(file.id) ?? 0) + CONTEXT_STEP,
                                        ),
                                      ),
                                    ),
                                  )
                                  .catch(() => {})
                              }
                            >
                              {fileContext.isLoading(file.id)
                                ? 'Loading…'
                                : `+${CONTEXT_STEP} context`}
                            </button>
                            {(contextLines.get(file.id) ?? 0) > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setContextLines((values) => {
                                    const next = new Map(values)
                                    next.delete(file.id)
                                    return next
                                  })
                                }
                              >
                                Reset
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setSourceFileId(file.id)
                                void fileContext.load(file.id).catch(() => {})
                              }}
                            >
                              Browse source
                            </button>
                            <label className="file-viewed">
                              <input
                                type="checkbox"
                                aria-label={`Viewed ${file.path}`}
                                checked={fileSectionsViewed(file.id)}
                                onChange={() => toggleFile(file.id)}
                              />
                              Viewed
                            </label>
                          </div>
                        ) : null
                      }}
                      renderAnnotation={(annotation) => (
                        <InlineDiscussion
                          discussion={annotation.metadata}
                          body={body}
                          onBodyChange={setBody}
                          onSave={saveComment}
                          onCancel={() => setEditor(null)}
                          onEdit={editComment}
                          onDelete={deleteComment}
                          onReply={postReply}
                          submitted={Boolean(submitted)}
                        />
                      )}
                      renderGutterUtility={(getHoveredLine, item) => (
                        <button
                          className="line-comment-add"
                          aria-label="Comment on hovered line"
                          onClick={() => {
                            const hovered = getHoveredLine()
                            if (!hovered || !('side' in hovered)) return
                            commentOnLine({
                              fileId: item.id,
                              line: hovered.lineNumber,
                              side: hovered.side === 'deletions' ? DiffSide.left : DiffSide.right,
                            })
                          }}
                        >
                          <Plus size={13} />
                        </button>
                      )}
                      renderCodeViewFooter={
                        annotated.unplaced.length
                          ? () => (
                              <div className="unplaced-discussions">
                                <h3>Other discussions on these files</h3>
                                <p className="muted">
                                  These discussions refer to outdated code or lines outside the
                                  displayed sections.
                                </p>
                                {annotated.unplaced.map((thread) => (
                                  <div key={thread.id}>
                                    <div className="discussion-location">
                                      {thread.path}:{thread.line ?? thread.originalLine ?? 'file'}
                                    </div>
                                    <ThreadDiscussion thread={thread} onReply={postReply} />
                                  </div>
                                ))}
                              </div>
                            )
                          : undefined
                      }
                      options={{
                        // Pierre owns filenames inside its shadow root; its render callback keeps
                        // their controls aligned with the current virtualized item and collapse state.
                        onPostRender: (node, _instance, _phase, context) => {
                          const filename =
                            node.shadowRoot?.querySelector<HTMLElement>('[data-title]')
                          if (!filename) return
                          filename.setAttribute('role', 'button')
                          filename.tabIndex = 0
                          filename.setAttribute('aria-expanded', String(!context.item.collapsed))
                          filename.title = context.item.collapsed ? 'Expand file' : 'Collapse file'
                          filename.onclick = () =>
                            setFileCollapsed(context.item.id, !context.item.collapsed)
                          filename.onkeydown = (event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return
                            event.preventDefault()
                            setFileCollapsed(context.item.id, !context.item.collapsed)
                          }
                        },
                        theme: themeId,
                        themeType: resolvedTheme,
                        diffStyle: split ? 'split' : 'unified',
                        overflow: 'wrap',
                        enableLineSelection: true,
                        enableGutterUtility: true,
                        onLineNumberClick: (props, context) => {
                          if (props.type === 'diff-line' && context.type === 'diff')
                            commentOnLine({
                              fileId: context.item.id,
                              line: props.lineNumber,
                              side:
                                props.annotationSide === 'deletions'
                                  ? DiffSide.left
                                  : DiffSide.right,
                            })
                        },
                        onLineClick: (props, context) => {
                          if (props.type === 'diff-line' && context.type === 'diff')
                            commentOnLine({
                              fileId: context.item.id,
                              line: props.lineNumber,
                              side:
                                props.annotationSide === 'deletions'
                                  ? DiffSide.left
                                  : DiffSide.right,
                            })
                        },
                      }}
                    />
                  ) : (
                    <div className="empty-state">
                      <strong>
                        {unviewedOnly &&
                        viewedCount === selectedHunks.length &&
                        selectedHunks.length > 0
                          ? 'All diff sections in this group are viewed'
                          : 'No text patch in this group'}
                      </strong>
                      <span className="muted">
                        Binary files and pure renames may have no line changes.
                      </span>
                      <a href={`${pull.url}/files`} target="_blank" rel="noreferrer">
                        Inspect files on GitHub
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <strong>Choose a group to read its changes.</strong>
                </div>
              )}
            </section>
          )}
          {grouped && discussionTray && (
            <DiscussionsTray
              pull={pull}
              draft={draft}
              submitted={Boolean(submitted)}
              onSummaryChange={(summary) => {
                setDraft((previous) => ({ ...previous, summary }))
                setSubmitted(undefined)
              }}
              onEdit={editComment}
              onDelete={deleteComment}
              threads={discussions?.threads ?? []}
              onClose={() => setDiscussionTray(false)}
              onReply={postReply}
              onOpenLocation={(location) => {
                const group = discussionGroup({ pull, ...location })
                if (!group) {
                  setNotice(
                    grouped
                      ? 'This file is outside the current diff.'
                      : 'Organize changes to review this PR.',
                  )
                  return
                }
                const file = pull.files.find((file) => file.path === location.path)
                if (file) setFileCollapsed(file.id, false, group.id)
                changeView({ groupId: group.id })
              }}
            />
          )}
        </div>
      </div>
      <Dialog
        open={submitOpen}
        onOpenChange={(open) => {
          if (!submitting) setSubmitOpen(open)
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Submit to GitHub</DialogTitle>
            <DialogDescription>
              {pull.owner}/{pull.repo} #{pull.number} · commit {pull.headSha.slice(0, 7)}
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <label>
              Review summary
              <textarea
                aria-label="Submission summary"
                rows={3}
                value={draft.summary}
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, summary: event.target.value }))
                }
                placeholder="Optional summary…"
                maxLength={30000}
              />
            </label>
            <div className="review-events">
              {Object.values(ReviewEvent).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="review-event"
                    checked={event === value}
                    onChange={() => setEvent(value)}
                  />
                  {eventLabels[value]}
                </label>
              ))}
            </div>
            <p className="muted">
              {draft.comments.length} comments will be published as one review under your GitHub
              account.
            </p>
            <div className="submit-preview">
              {draft.comments.map((comment) => (
                <article key={comment.id}>
                  <strong>
                    {comment.path
                      ? `${comment.path}:${comment.line} (${comment.side})`
                      : 'Review note'}
                  </strong>
                  <p>{comment.body}</p>
                </article>
              ))}
            </div>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                disabled={
                  submitting ||
                  Boolean(submitted) ||
                  (!draft.summary.trim() && !draft.comments.length && event !== ReviewEvent.approve)
                }
                onClick={() => void submit()}
              >
                {submitting ? 'Submitting…' : `Submit ${eventLabels[event].toLowerCase()}`}
              </Button>
            </div>
          </div>
        </DialogPopup>
      </Dialog>
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Copy your feedback</DialogTitle>
            <DialogDescription>Select and copy this text into your coding agent.</DialogDescription>
          </DialogHeader>
          <div className="dialog-body">
            <textarea
              aria-label="Exported feedback"
              rows={14}
              readOnly
              value={exportFeedback(pull, draft)}
              onFocus={(event) => event.target.select()}
            />
          </div>
        </DialogPopup>
      </Dialog>
      <StackDialog
        url={stackOpen ? pull.url : undefined}
        stack={stack ?? undefined}
        currentNumber={pull.number}
        filter={inboxFilter}
        onClose={() => setStackOpen(false)}
      />
      <SourceContextDialog
        key={`${pull.id}/${sourceFileId ?? ''}`}
        pull={pull}
        fileId={sourceFileId}
        content={sourceFileId ? fileContext.contents.get(sourceFileId) : undefined}
        error={sourceFileId ? fileContext.error(sourceFileId) : undefined}
        onRetry={() => {
          if (sourceFileId) void fileContext.load(sourceFileId).catch(() => {})
        }}
        onClose={() => setSourceFileId(undefined)}
      />
      <PullStatusDialog
        url={statusOpen ? pull.url : undefined}
        status={pullStatus.status}
        error={pullStatus.error}
        section={statusSection}
        snapshotHeadSha={pull.headSha}
        onClose={() => setStatusOpen(false)}
      />
      <Dialog open={descriptionOpen} onOpenChange={setDescriptionOpen}>
        <DialogPopup className="description-dialog">
          <DialogHeader>
            <DialogTitle>PR description</DialogTitle>
            <DialogDescription>{pull.title}</DialogDescription>
          </DialogHeader>
          <div className="dialog-body description-body">
            <PullDescription pull={pull} />
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  )
}
