import type { Provider } from '../../shared/domain/types'
import { PanelPickerPopover } from '../features/panel/PanelPicker'
import { StackReview, type RenderStackStart } from '../features/stack-review/StackReview'
import { StackReviewPage } from '../features/stack-review/StackReviewPage'
import { reviewPath, stackReviewPath, type AppRoute, type InboxFilter } from '../lib/routes'

export function renderStackStart(provider?: Provider): RenderStackStart {
  return ({ label, disabled, busy, error, start }) => (
    <PanelPickerPopover
      label={label}
      subject="this stack"
      provider={provider}
      disabled={disabled}
      start={{ run: start, starting: busy, error }}
    />
  )
}

export function renderStackReview(filter: InboxFilter, onClose: () => void, provider?: Provider) {
  return (url: string) => (
    <StackReview
      url={url}
      renderStart={renderStackStart(provider)}
      openPath={stackReviewPath({ url, filter })}
      onOpen={onClose}
    />
  )
}

export function StackReviewRoute({
  route,
  provider,
}: {
  route: Extract<AppRoute, { kind: 'stack-review' }>
  provider?: Provider
}) {
  const url = `https://github.com/${route.repository}/pull/${route.number}`
  return (
    <StackReviewPage
      key={url}
      url={url}
      renderStart={renderStackStart(provider)}
      backPath={reviewPath({ url, filter: route.filter })}
    />
  )
}
