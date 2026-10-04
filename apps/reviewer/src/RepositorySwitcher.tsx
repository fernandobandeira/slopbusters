import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Check, ChevronDown, Clock3, GitBranch, Search } from 'lucide-react'
import type { Repository } from '../shared/types'
import { Button } from './vendor/t3/components/ui/button'
import { Badge } from './vendor/t3/components/ui/badge'
import { Input } from './vendor/t3/components/ui/input'

export function RepositorySwitcher({
  repository,
  repositories,
  recentRepositories,
  unavailableMessage,
  onSelect,
}: {
  repository: string
  repositories: Repository[]
  recentRepositories: string[]
  unavailableMessage?: string
  onSelect: (repository: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const search = query.trim().toLowerCase()
  const byName = new Map(repositories.map((repo) => [repo.fullName.toLowerCase(), repo]))
  const recentNames = new Set(recentRepositories.map((name) => name.toLowerCase()))
  const recent = recentRepositories
    .filter((name) => name.toLowerCase().includes(search))
    .map(
      (name) =>
        byName.get(name.toLowerCase()) ?? { fullName: name, description: '', private: false },
    )
  const other = repositories.filter(
    (repo) =>
      !recentNames.has(repo.fullName.toLowerCase()) && repo.fullName.toLowerCase().includes(search),
  )

  function renderRepository(repo: Repository) {
    const selected = repository.toLowerCase() === repo.fullName.toLowerCase()
    return (
      <button
        type="button"
        className="repository-row"
        key={repo.fullName}
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          onSelect(repo.fullName)
          setOpen(false)
        }}
      >
        <GitBranch size={15} aria-hidden="true" />
        <div>
          <strong>{repo.fullName}</strong>
          {repo.description && <span>{repo.description}</span>}
        </div>
        {repo.private && <Badge variant="outline">Private</Badge>}
        {selected && <Check size={15} aria-hidden="true" />}
      </button>
    )
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) setQuery('')
      }}
    >
      <Popover.Trigger
        render={<Button variant="ghost" className="repository-switcher-trigger" />}
        aria-label={`Switch repository: ${repository || 'Choose a repository'}`}
      >
        <span>{repository || 'Choose a repository'}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="repository-switcher-positioner"
        >
          <Popover.Popup className="repository-switcher-popup">
            <Popover.Title className="repository-switcher-title">Choose a repository</Popover.Title>
            <div className="search-field">
              <Search size={16} aria-hidden="true" />
              <Input
                aria-label="Search repositories"
                placeholder="Search owner or repository…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="repository-list">
              {recent.length > 0 && (
                <section aria-label="Recently visited repositories">
                  <h2 className="repository-section-title">
                    <Clock3 size={13} aria-hidden="true" />
                    Recently visited
                  </h2>
                  {recent.map(renderRepository)}
                </section>
              )}
              {other.length > 0 && (
                <section aria-label="All repositories">
                  <h2 className="repository-section-title">
                    {recentRepositories.length ? 'All repositories' : 'Your repositories'}
                  </h2>
                  {other.map(renderRepository)}
                </section>
              )}
              {!recent.length && !other.length && (
                <p className="muted" role="status">
                  {search
                    ? 'No repositories match your search.'
                    : unavailableMessage || 'Loading repositories…'}
                </p>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
