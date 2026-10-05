import { useState } from 'react'
import type {
  NavigationRequest,
  NavigationResult,
  NavigationTarget,
} from '../../../shared/domain/navigation'

interface Props {
  navigation: NavigationResult & { kind: NavigationRequest['kind'] }
  selected?: NavigationTarget
  busy: boolean
  onOpen: (target: NavigationTarget) => void
}

export function SourceNavigationResults({ navigation, selected, busy, onOpen }: Props) {
  const [filter, setFilter] = useState('')
  const groups = filteredGroups(navigation.targets, filter)
  const count = [...groups.values()].reduce((total, targets) => total + targets.length, 0)
  const title =
    navigation.mode === 'text'
      ? 'Text matches'
      : navigation.kind === 'references'
        ? 'References'
        : navigation.kind === 'implementation'
          ? 'Implementations'
          : 'Definitions'
  return (
    <aside className="source-context-targets" aria-label={title}>
      <div className="source-context-results-header">
        <strong>
          {title} · {navigation.targets.length}
        </strong>
        <input
          type="search"
          aria-label="Filter source results"
          placeholder="Filter by file or line…"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value)
          }}
        />
        <small role="status">
          {count} {count === 1 ? 'match' : 'matches'} in {groups.size}{' '}
          {groups.size === 1 ? 'file' : 'files'}
        </small>
      </div>
      <div className="source-context-results-list">
        {!count && <p>No matching results.</p>}
        {[...groups].map(([path, targets]) => (
          <SourceResultGroup
            key={path}
            path={path}
            targets={targets}
            selected={selected}
            busy={busy}
            onOpen={onOpen}
          />
        ))}
      </div>
    </aside>
  )
}

function filteredGroups(targets: NavigationTarget[], filter: string) {
  const query = filter.trim().toLowerCase()
  const groups = new Map<string, NavigationTarget[]>()
  for (const target of targets) {
    if (
      query &&
      !`${target.path} ${String(target.line)}:${String(target.column)} ${target.name}`
        .toLowerCase()
        .includes(query)
    )
      continue
    const group = groups.get(target.path) ?? []
    group.push(target)
    groups.set(target.path, group)
  }
  return groups
}

function SourceResultGroup({
  path,
  targets,
  selected,
  busy,
  onOpen,
}: Omit<Props, 'navigation'> & { path: string; targets: NavigationTarget[] }) {
  return (
    <details open className="source-context-result-group">
      <summary title={path}>
        <span>{path.split('/').at(-1)}</span>
        <small>{targets.length}</small>
        <span className="source-context-result-directory">
          {path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'}
        </span>
      </summary>
      {targets
        .sort((a, b) => a.line - b.line || a.column - b.column)
        .map((target) => (
          <button
            type="button"
            key={`${String(target.line)}:${String(target.column)}:${String(target.endLine)}:${String(target.endColumn)}`}
            disabled={busy}
            aria-current={
              selected?.path === path &&
              selected.line === target.line &&
              selected.column === target.column
                ? 'location'
                : undefined
            }
            onClick={() => {
              onOpen(target)
            }}
            title={`${path}:${String(target.line)}:${String(target.column)}`}
          >
            <span className="source-context-result-position">
              {target.line}:{target.column}
            </span>
            <span className="source-context-result-name">{target.name}</span>
          </button>
        ))}
    </details>
  )
}
