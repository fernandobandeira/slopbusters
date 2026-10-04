import { useEffect, useMemo, useRef, useState } from 'react'
import type { CodeViewHandle } from '@pierre/diffs/react'
import type { NavigationRequest, NavigationResult } from '../shared/navigation'
import type { PullFileContent, RevisionFileContent, SourceTree } from '../shared/fileContent'
import { DiffSide, type PullRequest } from '../shared/types'
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './vendor/t3/components/ui/dialog'
import { StyledDiffCodeView } from './vendor/t3/components/diffs/StyledDiffCodeView'
import { useReviewerTheme } from './ThemeProvider'
import { api, message } from './api'
import { clickedSymbol, type CodeSymbol } from './codeSymbols'
import { SymbolContextMenu, type SymbolMenuSelection } from './SymbolContextMenu'
import './sourceContext.css'

interface Props {
  pull: PullRequest
  fileId?: string
  content?: PullFileContent
  error?: string
  initialRequest?: NavigationRequest
  initialSymbol?: string
  onRetry: () => void
  onClose: () => void
}
interface SourceVisit {
  file: RevisionFileContent
  line: number
}

export function SourceContextDialog({
  pull,
  fileId,
  content,
  error,
  initialRequest,
  initialSymbol,
  onRetry,
  onClose,
}: Props) {
  const { themeId, resolvedTheme } = useReviewerTheme()
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null)
  const [side, setSide] = useState<'old' | 'new'>(
    initialRequest?.side === DiffSide.left ? 'old' : 'new',
  )
  const [line, setLine] = useState('1')
  const [visits, setVisits] = useState<SourceVisit[]>([])
  const [tree, setTree] = useState<SourceTree>()
  const [search, setSearch] = useState('')
  const [browse, setBrowse] = useState(false)
  const [busy, setBusy] = useState(Boolean(initialRequest))
  const [sourceError, setSourceError] = useState('')
  const [token, setToken] = useState<CodeSymbol | undefined>(
    initialRequest ? { ...initialRequest, text: initialSymbol ?? '' } : undefined,
  )
  const [symbolMenu, setSymbolMenu] = useState<SymbolMenuSelection>()
  const [navigation, setNavigation] = useState<NavigationResult>()
  const requestVersion = useRef(0)
  const savedRevision = content?.[side] ?? content?.old ?? content?.new
  const revision = visits.at(-1)?.file ?? savedRevision
  const actualSide = savedRevision
    ? savedRevision === content?.old
      ? DiffSide.left
      : DiffSide.right
    : side === 'old'
      ? DiffSide.left
      : DiffSide.right
  const file = pull.files.find((candidate) => candidate.id === fileId)
  const initialLine = file?.hunks[0]?.lines.find((entry) =>
    actualSide === DiffSide.right ? entry.newLine !== null : entry.oldLine !== null,
  )
  const targetLine =
    visits.at(-1)?.line ??
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
  const paths =
    tree?.paths.filter((path) => path.toLowerCase().includes(search.toLowerCase())) ?? []
  function jump(target: number) {
    const total = revision?.content.split('\n').length ?? 1
    const bounded = Math.min(total, Math.max(1, Math.floor(target) || 1))
    setLine(String(bounded))
    viewer.current?.scrollTo({ type: 'line', id: sourceId, lineNumber: bounded, align: 'center' })
  }
  useEffect(() => {
    if (!savedRevision || !fileId) return
    const controller = new AbortController()
    void api<SourceTree>(`/pulls/${encodeURIComponent(pull.id)}/source-tree?side=${actualSide}`, {
      signal: controller.signal,
    })
      .then(setTree)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setSourceError(message(failure))
      })
    return () => controller.abort()
  }, [pull.id, fileId, actualSide, savedRevision])
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
            setVisits([{ file: source, line: target.line }])
            setToken(undefined)
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
  async function openSource(path: string, target = 1) {
    const version = ++requestVersion.current
    setBusy(true)
    setSourceError('')
    try {
      const result = await api<RevisionFileContent>(
        `/pulls/${encodeURIComponent(pull.id)}/source-file?side=${actualSide}&path=${encodeURIComponent(path)}`,
      )
      if (version !== requestVersion.current) return
      setVisits((values) => [...values, { file: result, line: target }])
      setToken(undefined)
      setBrowse(false)
    } catch (failure) {
      if (version === requestVersion.current) setSourceError(message(failure))
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }
  async function navigate(kind: NavigationRequest['kind'], selection = token) {
    if (!revision || !selection) return
    const version = ++requestVersion.current
    setBusy(true)
    setSourceError('')
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
        if (kind !== 'references' && result.mode === 'semantic' && result.targets.length === 1)
          await openSource(result.targets[0].path, result.targets[0].line)
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
          <DialogDescription>
            Explore this review's saved source. Right-click a symbol for navigation; return to the
            diff to comment.
          </DialogDescription>
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
        {!revision && !error && <p className="muted">Loading exact source…</p>}
        {revision && (
          <>
            <div className="source-context-toolbar">
              <select
                aria-label="Source revision"
                value={actualSide === DiffSide.left ? 'old' : 'new'}
                onChange={(event) => {
                  requestVersion.current++
                  setSide(event.target.value as 'old' | 'new')
                  setVisits([])
                  setTree(undefined)
                  setToken(undefined)
                  setSymbolMenu(undefined)
                  setNavigation(undefined)
                  setSourceError('')
                  setBusy(false)
                }}
              >
                <option value="old" disabled={!content?.old}>
                  Base
                </option>
                <option value="new" disabled={!content?.new}>
                  Head
                </option>
              </select>
              <code title={revision.sha}>{revision.sha.slice(0, 8)}</code>
              <button type="button" onClick={() => setBrowse((value) => !value)}>
                Files
              </button>
              <button
                type="button"
                disabled={!visits.length || busy}
                onClick={() => {
                  requestVersion.current++
                  setVisits((values) => values.slice(0, -1))
                  setToken(undefined)
                  setNavigation(undefined)
                  setSourceError('')
                }}
              >
                Back to file
              </button>
              {revision.symbols.length > 0 && (
                <select
                  aria-label="Go to function or symbol"
                  value=""
                  onChange={(event) => jump(Number(event.target.value))}
                >
                  <option value="">Functions and symbols…</option>
                  {revision.symbols.map((symbol) => (
                    <option
                      key={`${symbol.kind}/${symbol.name}/${symbol.line}`}
                      value={symbol.line}
                    >
                      {symbol.name} · {symbol.line}–{symbol.endLine}
                    </option>
                  ))}
                </select>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  jump(Number(line))
                }}
              >
                <label>
                  Line{' '}
                  <input
                    aria-label="Source line"
                    type="number"
                    min="1"
                    value={line}
                    onChange={(event) => setLine(event.target.value)}
                  />
                </label>
                <button type="submit">Go</button>
              </form>
              <button type="button" onClick={onClose}>
                Back to diff
              </button>
            </div>
            <div className="source-context-navigation">
              <span>
                {token
                  ? `${token.text} · ${token.line}:${token.column}`
                  : 'Right-click a symbol or Cmd/Ctrl-click for its definition.'}
              </span>
              {busy && <span role="status">Loading…</span>}
            </div>
            {tree?.warnings.length || navigation?.warnings.length ? (
              <div className="source-context-warnings">
                {[...(tree?.warnings ?? []), ...(navigation?.warnings ?? [])].map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            ) : null}
            <div className="source-context-body">
              {browse && (
                <aside className="source-context-files">
                  <input
                    aria-label="Find source file"
                    placeholder="Find file…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  {!tree && <p>Loading files…</p>}
                  {paths.slice(0, 200).map((path) => (
                    <button
                      type="button"
                      disabled={busy}
                      key={path}
                      onClick={() => void openSource(path)}
                      title={path}
                    >
                      {path}
                    </button>
                  ))}
                  {paths.length > 200 && <p>Narrow your search to see more files.</p>}
                </aside>
              )}
              <StyledDiffCodeView
                key={sourceId}
                className="source-context-viewer"
                viewerRef={viewer}
                items={items}
                onTokenContextMenu={(props, event) => {
                  const selected = clickedSymbol(props, event)
                  if (!selected) return
                  event.preventDefault()
                  setToken(selected)
                  setSymbolMenu({ ...selected, x: event.clientX, y: event.clientY })
                }}
                options={{
                  theme: themeId,
                  themeType: resolvedTheme,
                  overflow: 'wrap',
                  enableLineSelection: true,
                  onLineNumberClick: (props) => setLine(String(props.lineNumber)),
                  onTokenClick: (props, event) => {
                    const selected = clickedSymbol(props, event)
                    setToken(selected)
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
                      onClick={() => void openSource(target.path, target.line)}
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
