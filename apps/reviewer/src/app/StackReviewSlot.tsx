import { savedPanelSelection } from '../features/panel/panelSelection'
import { StackReview } from '../features/stack-review/StackReview'
import { StackReviewPage } from '../features/stack-review/StackReviewPage'
import { reviewPath, stackReviewPath, type AppRoute, type InboxFilter } from '../lib/routes'

function reviewersLastPicked() {
  return savedPanelSelection().map(({ id, providers }) =>
    providers?.length ? { id, providers } : id,
  )
}

export function renderStackReview(filter: InboxFilter, onClose: () => void) {
  return (url: string) => (
    <StackReview
      url={url}
      reviewers={reviewersLastPicked()}
      openPath={stackReviewPath({ url, filter })}
      onOpen={onClose}
    />
  )
}

export function StackReviewRoute({
  route,
}: {
  route: Extract<AppRoute, { kind: 'stack-review' }>
}) {
  const url = `https://github.com/${route.repository}/pull/${route.number}`
  return (
    <StackReviewPage
      key={url}
      url={url}
      reviewers={reviewersLastPicked()}
      backPath={reviewPath({ url, filter: route.filter })}
    />
  )
}
