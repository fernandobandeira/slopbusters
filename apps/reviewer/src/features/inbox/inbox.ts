import type { RepositoryInbox } from '../../../shared/domain/types'
export type InboxFilter = 'mine' | 'others' | 'requested'
export function inboxPulls(inbox: RepositoryInbox, filter: InboxFilter) {
  return inbox.pulls.filter((pr) => {
    switch (filter) {
      case 'mine':
        return pr.author.toLowerCase() === inbox.viewer.toLowerCase()
      case 'others':
        return pr.author.toLowerCase() !== inbox.viewer.toLowerCase()
      case 'requested':
        return pr.reviewRequested
    }
  })
}

export const inboxFilters: { id: InboxFilter; label: string }[] = [
  { id: 'mine', label: 'My PRs' },
  { id: 'others', label: 'Others’ PRs' },
  { id: 'requested', label: 'Review requested' },
]
