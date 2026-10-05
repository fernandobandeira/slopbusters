import * as routes from '../../../shared/api'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type {
  NavigationRequest,
  NavigationResult,
  NavigationTarget,
} from '../../../shared/domain/navigation'
import type { PullFileContent } from '../../../shared/domain/fileContent'
import { DiffSide, type PullRequest } from '../../../shared/domain/types'
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from '~/components/ui/dialog'
import { StyledDiffCodeView } from '~/components/diffs/StyledDiffCodeView'
import { useReviewerTheme } from '../../app/ThemeProvider'
import { call, message } from '../../lib/api'
import { clickedSymbol, type CodeSymbol } from '../review/diff/codeSymbols'
import { SymbolContextMenu, type SymbolMenuSelection } from './SymbolContextMenu'
import { SourceNavigationResults } from './SourceNavigationResults'
import { destinationStyles, highlightDestination } from './sourceDestination'
import {
  emptySourceHistory,
  isCurrentDefinition,
  navigationOutcome,
  visitSource,
} from './sourceNavigationHistory'
import type { ReviewWorkspaceInfo } from '../../../shared/domain/workspace'
import '../../sourceContext.css'

interface Props {
  pull: PullRequest
  fileId?: string
  content?: PullFileContent
  error?: string
  initialRequest?: NavigationRequest
  onRetry: () => void
  onClose: () => void
}

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
  const [loadingMessage, setLoadingMessage] = useState(
    initialRequest ? navigationLoadingMessage(initialRequest.kind) : 'Loading source…',
  )
  const [sourceError, setSourceError] = useState('')
  const [symbolMenu, setSymbolMenu] = useState<SymbolMenuSelection>()
  const [navigation, setNavigation] = useState<
    NavigationResult & { kind: NavigationRequest['kind'] }
  >()
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
    return () => {
      cancelAnimationFrame(frame)
    }
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
    void call(
      routes.navigateSource,
      { params: { id: pull.id }, body: initialRequest },
      { signal: controller.signal },
    )
      .then(async (result) => {
        if (version !== requestVersion.current) return
        setNavigation({ ...result, kind: initialRequest.kind })
        setNotice(navigationOutcome(initialRequest.kind, result.targets.length))
        if (
          initialRequest.kind !== 'references' &&
          result.mode === 'semantic' &&
          result.targets.length === 1
        ) {
          const target = result.targets[0]
          if (!target) return
          setLoadingMessage('Opening source…')
          const source = await call(
            routes.getSourceFile,
            { params: { id: pull.id }, query: { side: initialRequest.side, path: target.path } },
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
    return () => {
      controller.abort()
    }
  }, [initialRequest, pull.id])
  async function openSource(target: NavigationTarget) {
    const version = ++requestVersion.current
    setBusy(true)
    setLoadingMessage('Opening source…')
    setSourceError('')
    setNotice('')
    try {
      const result =
        revision?.path === target.path
          ? revision
          : await call(routes.getSourceFile, {
              params: { id: pull.id },
              query: { side: actualSide, path: target.path },
            })
      if (version !== requestVersion.current) return
      setHistory((current) => visitSource(current, { file: result, target }))
    } catch (failure) {
      if (version === requestVersion.current) setSourceError(message(failure))
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }
  async function navigate(kind: NavigationRequest['kind'], selection?: CodeSymbol) {
    if (busy || !revision || !selection) return
    const version = ++requestVersion.current
    setBusy(true)
    setLoadingMessage(navigationLoadingMessage(kind))
    setSourceError('')
    setNotice('')
    setNavigation(undefined)
    try {
      const result = await call(routes.navigateSource, {
        params: { id: pull.id },
        body: {
          side: actualSide,
          path: revision.path,
          line: selection.line,
          column: selection.column,
          kind,
        },
      })
      if (version !== requestVersion.current) return
      setNavigation({ ...result, kind })
      setNotice(navigationOutcome(kind, result.targets.length))
      const target = result.targets[0]
      if (
        kind === 'references' ||
        result.mode !== 'semantic' ||
        result.targets.length !== 1 ||
        !target
      )
        return
      if (isCurrentDefinition(revision.path, selection, target))
        setNotice('Already at this definition.')
      else await openSource(target)
    } catch (failure) {
      if (version === requestVersion.current) setSourceError(message(failure))
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }
  async function prepareLocalSource() {
    const version = ++requestVersion.current
    setBusy(true)
    setLoadingMessage('Preparing local source…')
    setSourceError('')
    try {
      const prepared = await call(routes.prepareWorkspace, {
        params: { id: pull.id },
        body: { side: actualSide },
      })
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
      <DialogPopup className="source-context-dialog" aria-busy={busy}>
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
        {(busy || (!revision && !error && !sourceError)) && (
          <div className="source-context-navigation" role="status">
            <LoaderCircle size={14} className="source-context-spinner" aria-hidden="true" />
            {busy ? loadingMessage : 'Loading exact source…'}
          </div>
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
                    if (node.shadowRoot) highlightDestination(node.shadowRoot, visit?.target)
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
              {navigation &&
                navigation.targets.length > 0 &&
                (navigation.kind !== 'definition' ||
                  navigation.mode === 'text' ||
                  navigation.targets.length > 1) && (
                  <SourceNavigationResults
                    key={JSON.stringify(navigation)}
                    navigation={navigation}
                    selected={visit?.target}
                    busy={busy}
                    onOpen={(target) => void openSource(target)}
                  />
                )}
            </div>
          </>
        )}
        <SymbolContextMenu
          selection={symbolMenu}
          source={revision ? { pullId: pull.id, side: actualSide, path: revision.path } : undefined}
          onNavigate={(kind) => {
            void navigate(kind, symbolMenu)
            setSymbolMenu(undefined)
          }}
          onClose={() => {
            setSymbolMenu(undefined)
          }}
        />
      </DialogPopup>
    </Dialog>
  )
}

function navigationLoadingMessage(kind: NavigationRequest['kind']) {
  return kind === 'references'
    ? 'Finding references…'
    : kind === 'implementation'
      ? 'Finding implementations…'
      : 'Finding definition…'
}
