import type { PanelSeatRequest } from '../../shared/domain/panel'
import { savedPanelSelection } from '../features/panel/panelSelection'
import { StackReview } from '../features/stack-review/StackReview'

/** The whole-stack review inside the stack dialog, asking the reviewers last picked for a panel. */
export function renderStackReview(url: string) {
  const reviewers: PanelSeatRequest[] = savedPanelSelection().map(({ id, providers }) =>
    providers?.length ? { id, providers } : id,
  )
  return <StackReview url={url} reviewers={reviewers} />
}
