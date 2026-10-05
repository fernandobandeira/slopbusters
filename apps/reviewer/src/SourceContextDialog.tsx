import { useEffect, useMemo, useRef, useState } from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { NavigationRequest, NavigationResult, NavigationTarget } from '../shared/navigation'
import type { PullFileContent, RevisionFileContent } from '../shared/fileContent'
import { DiffSide, type PullRequest } from '../shared/types'
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from './vendor/t3/components/ui/dialog'
import { StyledDiffCodeView } from './vendor/t3/components/diffs/StyledDiffCodeView'
import { useReviewerTheme } from './ThemeProvider'
import { api, message } from './api'
import { clickedSymbol, type CodeSymbol } from './codeSymbols'
import { SymbolContextMenu, type SymbolMenuSelection } from './SymbolContextMenu'
import {
  emptySourceHistory,
  isCurrentDefinition,
  navigationOutcome,
  visitSource,
} from './sourceNavigationHistory'
import type { ReviewWorkspaceInfo } from '../shared/workspace'
import { WorkspaceSetupPanel } from './WorkspaceSetupPanel'
import './sourceContext.css'

interface Props {
  pull: PullRequest
  fileId?: string
  content?: PullFileContent
  error?: string
  initialRequest?: NavigationRequest
  onRetry: () => void
  onClose: () => void
}

const destinationStyles = `
[data-line][data-source-destination] {
  background: color-mix(in srgb, var(--primary) 16%, transparent);
  box-shadow: inset 3px 0 var(--primary);
  animation: source-destination-arrival 900ms ease-out;
}
[data-source-destination-token] {
  background: color-mix(in srgb, var(--primary) 26%, transparent);
  outline: 1px solid color-mix(in srgb, var(--primary) 55%, transparent);
  border-radius: 3px;
  font-weight: 700;
}
@keyframes source-destination-arrival {
  from { background: color-mix(in srgb, var(--primary) 36%, transparent); }
  to { background: color-mix(in srgb, var(--primary) 16%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  [data-line][data-source-destination] { animation: none; }
}
`

export function SourceContextDialog({
  pull,
  fileId,
  content,
  error,
  initialRequest,
  onRetry,
  onClose,
}: Props) {
  const { themeId, resolvedTheme } = useReviewerTheme()
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
  const side = initialRequest?.side === DiffSide.left ? 'old' : 'new'
  const [history, setHistory] = useState(emptySourceHistory)
  const visit = history.visits[history.index]
  const [notice, setNotice] = useState('')
  const [workspace, setWorkspace] = useState<ReviewWorkspaceInfo>()
  const [busy, setBusy] = useState(Boolean(initialRequest))
  const [sourceError, setSourceError] = useState('')
  const [symbolMenu, setSymbolMenu] = useState<SymbolMenuSelection>()
  const [navigation, setNavigation] = useState<NavigationResult>()
  const requestVersion = useRef(0)
  const savedRevision = content?.[side] ?? content?.old ?? content?.new
  const revision = visit?.file ?? savedRevision
  const actualSide =
    initialRequest?.side ??
    (savedRevision && savedRevision === content?.old ? DiffSide.left : DiffSide.right)
  const file = pull.files.find((candidate) => candidate.id === fileId)
  const initialLine = file?.hunks[0]?.lines.find((entry) =>
    actualSide === DiffSide.right ? entry.newLine !== null : entry.oldLine !== null,
  )
  const targetLine =
    visit?.target.line ??
    initialRequest?.line ??
    (actualSide === DiffSide.right ? initialLine?.newLine : initialLine?.oldLine) ??
    1
  const sourceId = revision ? `${revision.sha}:${revision.path}` : ''
  const items = useMemo(
    () =>
      revision
        ? [
            {
              id: sourceId,
              type: 'file' as const,
              file: { name: revision.path, contents: revision.content, cacheKey: sourceId },
            },
          ]
        : [],
    [revision, sourceId],
  )
  const warnings = [...new Set([...(navigation?.warnings ?? []), ...(workspace?.warnings ?? [])])]
  useEffect(() => {
    if (!revision) return
    const frame = requestAnimationFrame(() =>
      viewer.current?.scrollTo({
        type: 'line',
        id: sourceId,
        lineNumber: targetLine,
        align: 'center',
      }),
    )
    return () => cancelAnimationFrame(frame)
  }, [revision, sourceId, targetLine])
  useEffect(
    () => () => {
      requestVersion.current++
    },
    [],
  )
  useEffect(() => {
    if (!initialRequest) return
    const controller = new AbortController()
    const version = ++requestVersion.current
    void api<NavigationResult>(`/pulls/${encodeURIComponent(pull.id)}/navigation`, {
      method: 'POST',
      body: JSON.stringify(initialRequest),
      signal: controller.signal,
    })
      .then(async (result) => {
        if (version !== requestVersion.current) return
        setNavigation(result)
        setNotice(navigationOutcome(initialRequest.kind, result.targets.length))
        if (
          initialRequest.kind !== 'references' &&
          result.mode === 'semantic' &&
          result.targets.length === 1
        ) {
          const target = result.targets[0]
          const source = await api<RevisionFileContent>(
            `/pulls/${encodeURIComponent(pull.id)}/source-file?side=${initialRequest.side}&path=${encodeURIComponent(target.path)}`,
            { signal: controller.signal },
          )
          if (version === requestVersion.current) {
            setHistory((current) => visitSource(current, { file: source, target }))
          }
        }
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && version === requestVersion.current)
          setSourceError(message(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted && version === requestVersion.current) setBusy(false)
      })
    return () => controller.abort()
  }, [initialRequest, pull.id])
  async function openSource(target: NavigationTarget) {
    const version = ++requestVersion.current
    setBusy(true)
    setSourceError('')
    setNotice('')
    try {
      const result = await api<RevisionFileContent>(
        `/pulls/${encodeURIComponent(pull.id)}/source-file?side=${actualSide}&path=${encodeURIComponent(target.path)}`,
      )
      if (version !== requestVersion.current) return
      setHistory((current) => visitSource(current, { file: result, target }))
    } catch (failure) {
      if (version === requestVersion.current) setSourceError(message(failure))
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }
  async function navigate(kind: NavigationRequest['kind'], selection?: CodeSymbol) {
    if (!revision || !selection) return
    const version = ++requestVersion.current
    setBusy(true)
    setSourceError('')
    setNotice('')
    setNavigation(undefined)
    try {
      const result = await api<NavigationResult>(
        `/pulls/${encodeURIComponent(pull.id)}/navigation`,
        {
          method: 'POST',
          body: JSON.stringify({
            side: actualSide,
            path: revision.path,
            line: selection.line,
            column: selection.column,
            kind,
          }),
        },
      )
      if (version === requestVersion.current) {
        setNavigation(result)
        setNotice(navigationOutcome(kind, result.targets.length))
        if (kind !== 'references' && result.mode === 'semantic' && result.targets.length === 1) {
          if (isCurrentDefinition(revision.path, selection, result.targets[0]))
            setNotice('Already at this definition.')
          else await openSource(result.targets[0])
        }
      }
    } catch (failure) {
      if (version === requestVersion.current) setSourceError(message(failure))
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }
  async function prepareLocalSource() {
    const version = ++requestVersion.current
    setBusy(true)
    setSourceError('')
    try {
      const prepared = await api<ReviewWorkspaceInfo>(
        `/pulls/${encodeURIComponent(pull.id)}/workspace`,
        {
          method: 'POST',
          body: JSON.stringify({ side: actualSide }),
        },
      )
      if (version === requestVersion.current) {
        setWorkspace(prepared)
        setNotice('Local source is ready. Use Go to definition to navigate this checkout.')
      }
    } catch (failure) {
      if (version === requestVersion.current) setSourceError(message(failure))
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }
  return (
    <Dialog
      open={Boolean(fileId)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogPopup className="source-context-dialog">
        <DialogHeader>
          <DialogTitle>{revision?.path ?? file?.path ?? 'Source'}</DialogTitle>
        </DialogHeader>
        {(error || sourceError) && (
          <div className="source-context-error" role="alert">
            {sourceError || error}{' '}
            {error && (
              <button type="button" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        )}
        {!revision && !error && (
          <p className="source-context-loading muted">Loading exact source…</p>
        )}
        {revision && (
          <>
            <nav className="source-context-toolbar" aria-label="Source navigation">
              <button
                type="button"
                aria-label="Back in source"
                disabled={busy || history.index < 0}
                onClick={() => {
                  setHistory((current) => ({ ...current, index: current.index - 1 }))
                  setNavigation(undefined)
                  setNotice('')
                }}
              >
                ← Back
              </button>
              <button
                type="button"
                aria-label="Forward in source"
                disabled={busy || history.index + 1 >= history.visits.length}
                onClick={() => {
                  setHistory((current) => ({ ...current, index: current.index + 1 }))
                  setNavigation(undefined)
                  setNotice('')
                }}
              >
                Forward →
              </button>
              <span className="muted" title={workspace?.directory}>
                {navigation?.source?.kind === 'local' || workspace?.status === 'ready'
                  ? 'Local checkout'
                  : 'Saved source'}{' '}
                · {revision.sha.slice(0, 8)}
              </span>
              {navigation?.source?.kind !== 'local' && workspace?.status !== 'ready' && (
                <button type="button" disabled={busy} onClick={() => void prepareLocalSource()}>
                  Prepare local source
                </button>
              )}
            </nav>
            {busy && (
              <div className="source-context-navigation" role="status">
                Loading…
              </div>
            )}
            {notice && (
              <p className="source-context-notice" role="status">
                {notice}
              </p>
            )}
            {warnings.length > 0 && (
              <div className="source-context-warnings">
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}
            {navigation && (!navigation.targets.length || warnings.length > 0) && (
              <WorkspaceSetupPanel key={`${pull.id}:${revision.sha}`} pullId={pull.id} sha={revision.sha}
                side={actualSide} path={revision.path} warnings={warnings} />
            )}
            <div className="source-context-body">
              <StyledDiffCodeView
                key={sourceId}
                className="source-context-viewer"
                viewerRef={viewer}
                items={items}
                unsafeCSSExtra={destinationStyles}
                onTokenContextMenu={(props, event) => {
                  const selected = clickedSymbol(props, event)
                  if (!selected) return
                  event.preventDefault()
                  setSymbolMenu({ ...selected, x: event.clientX, y: event.clientY })
                }}
                options={{
                  onPostRender: (node) => {
                    const target = visit?.target
                    for (const row of node.shadowRoot?.querySelectorAll<HTMLElement>(
                      '[data-line]',
                    ) ?? []) {
                      const line = Number(row.dataset.line)
                      const focused = Boolean(
                        target && line >= target.line && line <= target.endLine,
                      )
                      row.toggleAttribute('data-source-destination', focused)
                      for (const token of row.querySelectorAll<HTMLElement>('[data-char]')) {
                        const start = Number(token.dataset.char)
                        const end = start + (token.textContent?.length ?? 0)
                        token.toggleAttribute(
                          'data-source-destination-token',
                          Boolean(
                            focused &&
                            target &&
                            (line !== target.line || end > target.column - 1) &&
                            (line !== target.endLine || start < target.endColumn - 1),
                          ),
                        )
                      }
                    }
                  },
                  theme: themeId,
                  themeType: resolvedTheme,
                  overflow: 'wrap',
                  enableLineSelection: true,
                  onTokenClick: (props, event) => {
                    const selected = clickedSymbol(props, event)
                    if (selected && (event.metaKey || event.ctrlKey))
                      void navigate('definition', selected)
                  },
                }}
              />
              {navigation && (
                <aside className="source-context-targets">
                  <strong>
                    {navigation.mode === 'semantic' ? 'Source locations' : 'Text matches'} ·{' '}
                    {navigation.targets.length}
                  </strong>
                  {!navigation.targets.length && <p>No locations found.</p>}
                  {navigation.targets.map((target, index) => (
                    <button
                      type="button"
                      key={`${target.path}:${target.line}:${target.column}:${index}`}
                      disabled={busy}
                      onClick={() => void openSource(target)}
                      title={target.name}
                    >
                      <span>
                        {target.path}:{target.line}:{target.column}
                      </span>
                      <small>{target.name}</small>
                    </button>
                  ))}
                </aside>
              )}
            </div>
          </>
        )}
        <SymbolContextMenu
          selection={symbolMenu}
          onNavigate={(kind) => {
            void navigate(kind, symbolMenu)
            setSymbolMenu(undefined)
          }}
          onClose={() => setSymbolMenu(undefined)}
        />
      </DialogPopup>
    </Dialog>
  )
}
