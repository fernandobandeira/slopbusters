import { ClaudeAI, OpenAI } from '~/components/Icons'
import type { PanelReviewer } from '../../../shared/domain/panel'
import { Provider } from '../../../shared/domain/types'

/** The provider a seat reviews on; seats saved before providers per seat show nothing. */
export function ProviderMark({ reviewer }: { reviewer: PanelReviewer }) {
  const provider = reviewer.model?.provider
  if (!provider) return null
  const Logo = provider === Provider.claude ? ClaudeAI : OpenAI
  const label = provider === Provider.claude ? 'Claude' : 'Codex'
  return (
    <span role="img" aria-label={`on ${label}`} title={`${label} · ${reviewer.model?.model ?? ''}`}>
      <Logo className="size-3" />
    </span>
  )
}
