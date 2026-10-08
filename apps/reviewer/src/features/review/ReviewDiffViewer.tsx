import type { RefObject, Dispatch, SetStateAction } from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { StyledDiffCodeView } from '~/components/diffs/StyledDiffCodeView'
import {
  DiffSide,
  type PullRequest,
  type DraftComment,
  type ReviewThread,
} from '../../../shared/domain/types'
import type { NavigationRequest } from '../../../shared/domain/navigation'
import { useReviewerTheme } from '../../app/ThemeProvider'
import { InlineDiscussion, ThreadDiscussion } from './discussions/InlineDiscussion'
import { SectionBar } from './SectionBar'
import type { SyntheticItemKind } from './reviewUpdates'
import { clickedSymbol } from './diff/codeSymbols'
import type { SymbolMenuSelection } from '../source-navigation/SymbolContextMenu'
import type { useFileContext } from './diff/useFileContext'
import {
  hasDiscussion,
  type annotateDiscussions,
  type LineDiscussion,
} from './discussions/discussions'
import { CONTEXT_STEP, MAX_CONTEXT } from './diff/displayContext'

type Selection = SymbolMenuSelection & { fileId: string; side: DiffSide; path: string }
interface Props {
  pull: PullRequest
  split: boolean
  viewerRef: RefObject<CodeViewHandle<LineDiscussion, undefined> | null>
  annotated: ReturnType<typeof annotateDiscussions>
  fileContext: ReturnType<typeof useFileContext>
  contextLines: Map<string, number>
  setContextLines: Dispatch<SetStateAction<Map<string, number>>>
  setSymbolMenu: Dispatch<SetStateAction<Selection | undefined>>
  setFileCollapsed: (fileId: string, collapsed: boolean) => void
  fileSectionsViewed: (fileId: string) => boolean
  toggleFile: (fileId: string) => void
  syntheticItems: ReadonlyMap<string, SyntheticItemKind>
  onToggleSection: (hunkId: string) => void
  body: string
  setBody: (body: string) => void
  saveComment: () => void
  setEditor: Dispatch<SetStateAction<Omit<DraftComment, 'body'> | null>>
  editComment: (comment: DraftComment) => void
  deleteComment: (comment: DraftComment) => void
  postReply: (thread: ReviewThread, body: string) => Promise<void>
  submitted?: string
  commentOnLine: (location: { fileId: string; line: number; side: DiffSide }) => void
  navigateSymbol: (kind: NavigationRequest['kind'], selection?: Selection) => void
}
export function ReviewDiffViewer({
  pull,
  split,
  viewerRef,
  annotated,
  fileContext,
  contextLines,
  setContextLines,
  setSymbolMenu,
  setFileCollapsed,
  fileSectionsViewed,
  toggleFile,
  syntheticItems,
  onToggleSection,
  body,
  setBody,
  saveComment,
  setEditor,
  editComment,
  deleteComment,
  postReply,
  submitted,
  commentOnLine,
  navigateSymbol,
}: Props) {
  const { themeId, resolvedTheme } = useReviewerTheme()
  return (
    <StyledDiffCodeView
      className="viewer"
      viewerRef={viewerRef}
      items={annotated.items}
      onTokenContextMenu={(props, event, item) => {
        const symbol = clickedSymbol(props, event)
        const file = pull.files.find((file) => file.id === item.id)
        if (!symbol || !file) return
        event.preventDefault()
        setSymbolMenu({
          ...symbol,
          x: event.clientX,
          y: event.clientY,
          fileId: file.id,
          side: props.side === 'deletions' ? DiffSide.left : DiffSide.right,
          path: props.side === 'deletions' ? (file.previousPath ?? file.path) : file.path,
        })
      }}
      renderHeaderPrefix={(item) => (
        <button
          type="button"
          className="file-collapse-toggle"
          aria-label={`${item.collapsed ? 'Expand' : 'Collapse'} ${item.type === 'diff' ? item.fileDiff.name : item.file.name}`}
          aria-expanded={!item.collapsed}
          title={item.collapsed ? 'Expand file' : 'Collapse file'}
          onClick={() => {
            setFileCollapsed(item.id, !item.collapsed)
          }}
        >
          {item.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
      renderHeaderMetadata={(item) => {
        const synthetic = syntheticItems.get(item.id)
        if (synthetic)
          return (
            <SyntheticItemHeader
              kind={synthetic}
              viewed={fileSectionsViewed(item.id)}
              onToggle={() => {
                toggleFile(item.id)
              }}
            />
          )
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
              title={fileContext.error(file.id) ?? 'Expand unchanged lines around these sections'}
              onClick={() =>
                void fileContext
                  .load(file.id)
                  .then(() => {
                    setContextLines((values) =>
                      new Map(values).set(
                        file.id,
                        Math.min(MAX_CONTEXT, (values.get(file.id) ?? 0) + CONTEXT_STEP),
                      ),
                    )
                  })
                  .catch(() => {})
              }
            >
              {fileContext.isLoading(file.id) ? 'Loading…' : `+${CONTEXT_STEP} context`}
            </button>
            {(contextLines.get(file.id) ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => {
                  setContextLines((values) => {
                    const next = new Map(values)
                    next.delete(file.id)
                    return next
                  })
                }}
              >
                Reset
              </button>
            )}
            <label className="file-viewed">
              <input
                type="checkbox"
                aria-label={`Viewed ${file.path}`}
                checked={fileSectionsViewed(file.id)}
                onChange={() => {
                  toggleFile(file.id)
                }}
              />
              Viewed
            </label>
          </div>
        ) : null
      }}
      renderAnnotation={(annotation) => (
        <>
          {hasDiscussion(annotation.metadata) && (
            <InlineDiscussion
              discussion={annotation.metadata}
              body={body}
              onBodyChange={setBody}
              onSave={saveComment}
              onCancel={() => {
                setEditor(null)
              }}
              onEdit={editComment}
              onDelete={deleteComment}
              onReply={postReply}
              submitted={Boolean(submitted)}
            />
          )}
          {annotation.metadata.sections.map((section) => (
            <SectionBar key={section.hunkId} section={section} onToggle={onToggleSection} />
          ))}
        </>
      )}
      renderGutterUtility={(getHoveredLine, item) =>
        syntheticItems.has(item.id) ? null : (
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
        )
      }
      renderCodeViewFooter={
        annotated.unplaced.length
          ? () => (
              <div className="unplaced-discussions">
                <h3>Other discussions on these files</h3>
                <p className="muted">
                  These discussions refer to outdated code or lines outside the displayed sections.
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
          const filename = node.shadowRoot?.querySelector<HTMLElement>('[data-title]')
          if (!filename) return
          filename.setAttribute('role', 'button')
          filename.tabIndex = 0
          filename.setAttribute('aria-expanded', String(!context.item.collapsed))
          filename.title = context.item.collapsed ? 'Expand file' : 'Collapse file'
          filename.onclick = () => {
            setFileCollapsed(context.item.id, !context.item.collapsed)
          }
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
        onTokenClick: (props, event, context) => {
          if (!(event.metaKey || event.ctrlKey) || context.type !== 'diff' || !('side' in props))
            return
          const symbol = clickedSymbol(props, event)
          const file = pull.files.find((file) => file.id === context.item.id)
          if (!symbol || !file) return
          navigateSymbol('definition', {
            ...symbol,
            x: event.clientX,
            y: event.clientY,
            fileId: file.id,
            side: props.side === 'deletions' ? DiffSide.left : DiffSide.right,
            path: props.side === 'deletions' ? (file.previousPath ?? file.path) : file.path,
          })
        },
        onLineNumberClick: (props, context) => {
          if (props.type === 'diff-line' && context.type === 'diff')
            commentOnLine({
              fileId: context.item.id,
              line: props.lineNumber,
              side: props.annotationSide === 'deletions' ? DiffSide.left : DiffSide.right,
            })
        },
        onLineClick: (props, context) => {
          if (props.event.metaKey || props.event.ctrlKey) return
          if (props.type === 'diff-line' && context.type === 'diff')
            commentOnLine({
              fileId: context.item.id,
              line: props.lineNumber,
              side: props.annotationSide === 'deletions' ? DiffSide.left : DiffSide.right,
            })
        },
      }}
    />
  )
}

const syntheticLabels: Record<SyntheticItemKind, { label: string; title: string }> = {
  interdiff: {
    label: 'Changed since your review',
    title: 'What changed in these sections since your last review. Show full sections to comment.',
  },
  removed: {
    label: 'No longer in this PR',
    title: 'Edits you reviewed that the PR no longer makes, shown reversed against your review.',
  },
}
function SyntheticItemHeader({
  kind,
  viewed,
  onToggle,
}: {
  kind: SyntheticItemKind
  viewed: boolean
  onToggle: () => void
}) {
  const { label, title } = syntheticLabels[kind]
  return (
    <div className="file-context-actions">
      <span className="section-update" title={title}>
        {label}
      </span>
      {kind === 'interdiff' && (
        <label className="file-viewed">
          <input
            type="checkbox"
            aria-label={`Viewed: ${label}`}
            checked={viewed}
            onChange={onToggle}
          />
          Viewed
        </label>
      )}
    </div>
  )
}
