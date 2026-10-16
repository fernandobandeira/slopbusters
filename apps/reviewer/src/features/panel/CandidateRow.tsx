import { Check } from 'lucide-react'
import { ClaudeAI, OpenAI } from '~/components/Icons'
import type { Teammate } from '../../../shared/domain/teammates'
import { Provider } from '../../../shared/domain/types'
import { ReviewerFace } from '../../components/ReviewerFace'
import { reviewerFaceSrc } from '../../lib/reviewerFaces'
import type { Candidate } from './panelSelection'

const providerLabels = { [Provider.codex]: 'Codex', [Provider.claude]: 'Claude' }

/** One reviewer: click the row to ask them, and the icons to pick Codex, Claude, or both. */
export function CandidateRow({
  candidate,
  teammates,
  providers,
  onToggle,
  onToggleProvider,
}: {
  candidate: Candidate
  teammates?: Teammate[]
  /** The providers this reviewer will run on; empty when not picked. */
  providers: Provider[]
  onToggle: () => void
  onToggleProvider: (provider: Provider) => void
}) {
  const checked = providers.length > 0
  return (
    <div className={`panel-candidate${checked ? ' panel-candidate-checked' : ''}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        className="panel-candidate-main"
        disabled={Boolean(candidate.unavailable)}
        onClick={onToggle}
      >
        <ReviewerFace
          name={candidate.name}
          src={reviewerFaceSrc(candidate.id, 'neutral', teammates)}
          size={32}
        />
        <span className="panel-candidate-text">
          <strong>{candidate.name}</strong>
          <span className="muted">{candidate.unavailable ?? candidate.description}</span>
        </span>
        <span className="panel-candidate-check" aria-hidden="true">
          {checked && <Check size={14} />}
        </span>
      </button>
      <div
        className="panel-candidate-providers"
        role="group"
        aria-label={`Run ${candidate.name} on`}
      >
        {[Provider.codex, Provider.claude].map((provider) => (
          <ProviderToggle
            key={provider}
            provider={provider}
            name={candidate.name}
            pressed={providers.includes(provider)}
            installed={candidate.installed[provider] && !candidate.unavailable}
            onToggle={() => {
              onToggleProvider(provider)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ProviderToggle({
  provider,
  name,
  pressed,
  installed,
  onToggle,
}: {
  provider: Provider
  name: string
  pressed: boolean
  installed: boolean
  onToggle: () => void
}) {
  const label = providerLabels[provider]
  const Logo = provider === Provider.claude ? ClaudeAI : OpenAI
  return (
    <button
      type="button"
      className="panel-provider"
      aria-pressed={pressed}
      aria-label={`${name} on ${label}`}
      title={
        installed ? `Run ${name} on ${label}` : `${name}'s skill is not installed for ${label}`
      }
      disabled={!installed}
      onClick={onToggle}
    >
      <Logo className="size-3.5" />
    </button>
  )
}
