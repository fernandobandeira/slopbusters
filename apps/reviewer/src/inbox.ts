import type { RepositoryInbox } from '../shared/types'
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
