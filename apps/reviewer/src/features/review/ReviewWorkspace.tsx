import { useClipboard } from '../../lib/useClipboard'
import { DescriptionDialog } from './DescriptionDialog'
import { ExportFeedbackDialog } from './ExportFeedbackDialog'
import { useCommentEditor } from './useCommentEditor'
import { useReviewDiff } from './useReviewDiff'
import { useReviewFocus } from './useReviewFocus'
import { ReviewDiffViewer } from './ReviewDiffViewer'
import { UPDATES_GROUP_ID } from './reviewUpdates'
import { useSectionCursor } from './useSectionCursor'
import { GroupSidebar } from './GroupSidebar'
import { SubmitReviewDialog } from './SubmitReviewDialog'
import { ReviewSubmitButton } from './ReviewSubmitButton'
import { useDiscussions } from './discussions/useDiscussions'
import { useOrganizeJob } from './useOrganizeJob'
import { useReviewSubmission } from './useReviewSubmission'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { Link } from 'react-router'

import { Check, Copy, MessageSquare, ArrowLeft, ArrowRight } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Badge } from '~/components/ui/badge'

import { message } from '../../lib/api'

import { SourceContextDialog } from '../source-navigation/SourceContextDialog'
import { SymbolContextMenu, type SymbolMenuSelection } from '../source-navigation/SymbolContextMenu'

import type { NavigationRequest } from '../../../shared/domain/navigation'
import {
  annotateDiscussions,
  discussionGroup,
  type LineDiscussion,
} from './discussions/discussions'

import { DiscussionsTray } from './discussions/DiscussionsTray'
import { CompactReviewHeader, ReviewPullDetails } from './CompactReviewHeader'
import { OrganizationEmptyState } from './OrganizationEmptyState'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'
import { useReviewDraft } from './useReviewDraft'
import { usePullUpdates } from '../pull-status/usePullUpdates'
import { usePullStack } from '../stacks/usePullStack'
import { usePullStatus } from '../pull-status/usePullStatus'
import { PullStatusDialog } from '../pull-status/PullStatusDialog'
import type { PullStatusSection } from '../pull-status/PullStatusIcons'

import { StackDialog } from '../stacks/StackPanel'
import { readRoute } from '../../lib/routes'

import { exportFeedback } from '../../../shared/domain/review'
import type { ReviewLocation } from '../../../shared/domain/review'
import { pullHasUpdates } from '../../../shared/domain/updates'
import { DiffSide, type PullRequest, type ReviewDraft } from '../../../shared/domain/types'

export interface ReviewCompanionContext {
  draft: ReviewDraft
  setDraft: (action: (previous: ReviewDraft) => ReviewDraft) => void
  ready: boolean
  openReview: () => void
  focusLine: (location: ReviewLocation | undefined) => void
}
interface Props {
  pull: PullRequest
  onUpdate: (pull: PullRequest) => void
  organization?: OrganizationPreferences
  onReload: () => void
  reloading: boolean
  inboxUrl: string
  renderCompanion?: (context: ReviewCompanionContext) => import('react').ReactNode
  titlebarTarget?: HTMLElement | null
  reviewActions?: import('react').ReactNode
}
export function ReviewWorkspace({
  pull,
  onUpdate,
  organization,
  onReload,
  reloading,
  inboxUrl,
  titlebarTarget,
  renderCompanion,
  reviewActions,
}: Props) {
  const {
    draft,
    setDraft,
    ready: draftReady,
    error: storageError,
    flush,
    changes,
    dismissChanges,
  } = useReviewDraft(pull)
  const {
    groups,
    grouped,
    split,
    unviewedOnly,
    updates: updatesGroup,
    fullSections,
    toggleSections,
    searchParams,
    setSearchParams,
    changeView,
    selected,
    selectedHunks,
    viewedCount,
    fileContext,
    contextLines,
    setContextLines,
    items,
    setFileCollapsed,
    toggleFile,
    fileSectionsViewed,
    markSectionViewed,
    sectionTargets,
    syntheticItems,
    viewedHunks,
  } = useReviewDiff(pull, draft, setDraft, changes)
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
  const [symbolMenu, setSymbolMenu] = useState<
    SymbolMenuSelection & { fileId: string; side: DiffSide; path: string }
  >()
  const [sourceSelection, setSourceSelection] = useState<{
    fileId: string
    request: NavigationRequest
    text: string
  }>()
  const sourceFileId = sourceSelection?.fileId
  function navigateSymbol(kind: NavigationRequest['kind'], selection = symbolMenu) {
    if (!selection) return
    const { fileId, side, path, line, column, text } = selection
    setSymbolMenu(undefined)
    setSourceSelection({ fileId, request: { kind, side, path, line, column }, text })
    void fileContext.load(fileId).catch(() => {})
  }
  const [discussionTray, setDiscussionTray] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const viewerRef = useRef<CodeViewHandle<LineDiscussion, undefined>>(null)
  const focus = useReviewFocus(pull, {
    searchParams,
    setSearchParams,
    setFileCollapsed,
    selected,
    items,
    viewerRef,
  })
  const { section: currentSection, setSection } = useSectionCursor({
    targets: sectionTargets,
    viewed: viewedHunks,
    items,
    markSectionViewed,
    setFileCollapsed,
    viewerRef,
    enabled: grouped && draftReady,
  })
  const { discussions, discussionError, refreshDiscussions, postReply, setDiscussionError } =
    useDiscussions(pull.id, setNotice)
  const { job, organizing, organizationFailed, organize, cancel } = useOrganizeJob(pull, {
    configured: Boolean(organization),
    onUpdate,
    setError,
    setNotice,
  })
  const {
    submitOpen,
    setSubmitOpen,
    event,
    setEvent,
    submitting,
    submitted,
    setSubmitted,
    submit,
  } = useReviewSubmission(pull, {
    draft,
    setDraft,
    flush,
    setError,
    setNotice,
    refreshDiscussions,
    setDiscussionError,
  })
  const {
    editor,
    setEditor,
    body,
    setBody,
    editComment,
    deleteComment,
    commentOnLine,
    saveComment,
  } = useCommentEditor(pull, {
    selected,
    changeView,
    setFileCollapsed,
    setDraft,
    setNotice,
    setSubmitted,
  })
  const [exportOpen, setExportOpen] = useState(false)
  const clipboard = useClipboard()
  const copied = clipboard.state === 'copied'
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const hasFeedback = draft.comments.length > 0 || draft.summary.trim().length > 0
  const annotated = useMemo(
    () =>
      annotateDiscussions({
        items,
        pull,
        discussions,
        comments: draft.comments,
        editor,
        sections: { targets: sectionTargets, viewed: viewedHunks, current: currentSection },
      }),
    [items, pull, discussions, draft.comments, editor, sectionTargets, viewedHunks, currentSection],
  )
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
  async function reloadReview() {
    try {
      await flush()
      onReload()
    } catch (error) {
      setError(message(error))
    }
  }
  const transfers = pull.transfers.filter((transfer) =>
    selected?.fileIds.some(
      (id) =>
        pull.files.find((file) => file.id === id)?.path === transfer.toPath ||
        pull.files.find((file) => file.id === id)?.path === transfer.fromPath,
    ),
  )

  async function copyFeedback() {
    if (!(await clipboard.copy(exportFeedback(pull, draft)))) setExportOpen(true)
  }
  if (!draftReady)
    return (
      <div className="empty-state" role={storageError ? 'alert' : 'status'}>
        <strong>{storageError ?? 'Loading saved review…'}</strong>
        {storageError && (
          <Button
            variant="outline"
            onClick={() => {
              window.location.reload()
            }}
          >
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
      <CompactReviewHeader pull={pull} />
      <div className="review-toolbar">
        {reviewActions}
        {grouped && (
          <>
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
            <ReviewSubmitButton
              pull={pull}
              isDraft={pullStatus.status?.isDraft ?? pull.isDraft ?? false}
              submitting={submitting}
              submitted={submitted}
              onSubmit={() => {
                setError('')
                setSubmitOpen(true)
              }}
              onReady={(updated) => {
                onUpdate(updated)
                pullStatus.refresh()
              }}
              onError={setError}
              onNotice={setNotice}
            />
          </>
        )}
      </div>
    </div>
  )
  return (
    <div className={`review-workspace ${focus.active ? 'review-focusing-line' : ''}`}>
      {grouped && organizing && (
        <div className="organization-overlay">
          <OrganizationEmptyState
            organization={organization}
            organizing
            onCancel={
              job
                ? () => {
                    void cancel().catch((cause) => {
                      setError(message(cause))
                    })
                  }
                : undefined
            }
          />
        </div>
      )}
      {grouped && (
        <GroupSidebar
          pull={pull}
          draft={draft}
          updates={updatesGroup}
          changes={changes}
          selectedId={selected?.id}
          inboxUrl={inboxUrl}
          submitting={submitting}
          organizing={organizing}
          onSelect={(groupId) => {
            changeView({ groupId })
          }}
          onRegenerate={() => void organize(true)}
          onDismissUpdates={() => {
            void dismissChanges().catch((cause: unknown) => {
              setError(`Could not dismiss review updates: ${message(cause)}`)
            })
          }}
          onNotice={setNotice}
        />
      )}
      <div className="review-content">
        {titlebarTarget ? createPortal(reviewHeader, titlebarTarget) : reviewHeader}
        <div className="review-context">
          <ReviewPullDetails
            pull={pull}
            onDescription={() => {
              setDescriptionOpen(true)
            }}
            onReload={() => void reloadReview()}
            hasUpdates={
              updates.hasUpdates ||
              Boolean(pullStatus.status && pullHasUpdates(pull, pullStatus.status))
            }
            updateCheckError={updates.error}
            stack={stackSummary}
            onStack={() => {
              setStackOpen(true)
            }}
            status={pullStatus.status}
            statusError={pullStatus.error}
            onStatus={(section) => {
              setStatusSection(section)
              setStatusOpen(true)
            }}
            reloading={reloading}
            organizing={organizing || submitting}
            changes={grouped ? changes : undefined}
            onChanges={() => {
              changeView({ groupId: UPDATES_GROUP_ID })
            }}
          />
          {grouped && groups.length > 0 && (
            <div className="review-view-controls">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  changeView({ split: !split })
                }}
              >
                {split ? 'Unified' : 'Split'}
              </Button>
              {selected?.id === UPDATES_GROUP_ID && (
                <Button
                  size="xs"
                  variant={fullSections ? 'secondary' : 'ghost'}
                  aria-pressed={fullSections}
                  title="Show whole sections instead of what changed since your review"
                  onClick={() => {
                    changeView({ fullSections: !fullSections })
                  }}
                >
                  Full sections
                </Button>
              )}
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
            </div>
          )}
        </div>
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
                void refreshDiscussions().catch((error) => {
                  setDiscussionError(message(error))
                })
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
        {pull.warnings.map((warning) => (
          <div className="warning-banner" key={warning}>
            {warning}
          </div>
        ))}
        <div className="review-body">
          {!grouped ? (
            <OrganizationEmptyState
              organization={organization}
              organizing={organizing || Boolean(organization && !organizationFailed)}
              failed={organizationFailed}
              onOrganize={() => void organize()}
              onCancel={
                job
                  ? () => {
                      void cancel().catch((error) => {
                        setError(message(error))
                      })
                    }
                  : undefined
              }
            />
          ) : (
            <section
              className="code-panel"
              data-diff-style={split ? 'split' : 'unified'}
              aria-label="Code changes"
            >
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
                    <ReviewDiffViewer
                      key={selected.id}
                      pull={pull}
                      split={split}
                      viewerRef={viewerRef}
                      annotated={annotated}
                      fileContext={fileContext}
                      contextLines={contextLines}
                      setContextLines={setContextLines}
                      setSymbolMenu={setSymbolMenu}
                      setFileCollapsed={setFileCollapsed}
                      fileSectionsViewed={fileSectionsViewed}
                      toggleFile={toggleFile}
                      syntheticItems={syntheticItems}
                      onToggleSection={(hunkId) => {
                        setSection(hunkId)
                        toggleSections([hunkId])
                      }}
                      body={body}
                      setBody={setBody}
                      saveComment={saveComment}
                      setEditor={setEditor}
                      editComment={editComment}
                      deleteComment={deleteComment}
                      postReply={postReply}
                      submitted={submitted}
                      commentOnLine={commentOnLine}
                      navigateSymbol={navigateSymbol}
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
              onClose={() => {
                setDiscussionTray(false)
              }}
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
      {renderCompanion?.({
        draft,
        setDraft,
        ready: draftReady,
        focusLine: focus.focusLine,
        openReview: () => {
          setSubmitOpen(true)
        },
      })}
      <SubmitReviewDialog
        open={submitOpen}
        pull={pull}
        draft={draft}
        event={event}
        submitting={submitting}
        submitted={submitted}
        error={error}
        onOpenChange={setSubmitOpen}
        onEventChange={setEvent}
        onSummaryChange={(summary) => {
          setDraft((previous) => ({ ...previous, summary }))
        }}
        onSubmit={() => void submit()}
      />
      <ExportFeedbackDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        pull={pull}
        draft={draft}
      />
      <StackDialog
        url={stackOpen ? pull.url : undefined}
        stack={stack ?? undefined}
        currentNumber={pull.number}
        filter={inboxFilter}
        onClose={() => {
          setStackOpen(false)
        }}
      />
      <SymbolContextMenu
        selection={symbolMenu}
        source={
          symbolMenu ? { pullId: pull.id, side: symbolMenu.side, path: symbolMenu.path } : undefined
        }
        onNavigate={navigateSymbol}
        onClose={() => {
          setSymbolMenu(undefined)
        }}
      />
      <SourceContextDialog
        key={`${pull.id}/${JSON.stringify(sourceSelection)}`}
        pull={pull}
        fileId={sourceFileId}
        initialRequest={sourceSelection?.request}
        content={sourceFileId ? fileContext.contents.get(sourceFileId) : undefined}
        error={sourceFileId ? fileContext.error(sourceFileId) : undefined}
        onRetry={() => {
          if (sourceFileId) void fileContext.load(sourceFileId).catch(() => {})
        }}
        onClose={() => {
          setSourceSelection(undefined)
        }}
      />
      <PullStatusDialog
        url={statusOpen ? pull.url : undefined}
        status={pullStatus.status}
        error={pullStatus.error}
        section={statusSection}
        snapshotHeadSha={pull.headSha}
        onClose={() => {
          setStatusOpen(false)
        }}
      />
      <DescriptionDialog open={descriptionOpen} onOpenChange={setDescriptionOpen} pull={pull} />
    </div>
  )
}
