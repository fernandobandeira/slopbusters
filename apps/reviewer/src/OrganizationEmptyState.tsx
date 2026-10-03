import { Layers, LoaderCircle } from 'lucide-react'
import { Provider, type AppStatus } from '../shared/types'
import { OpenAI, ClaudeAI } from './vendor/t3/components/ProviderLogos'
import { Button } from './vendor/t3/components/ui/button'

interface Props {
  provider: Provider
  status?: AppStatus
  organizing: boolean
  onProviderChange: (provider: Provider) => void
  onOrganize: () => void
  onCancel?: () => void
}

export function OrganizationEmptyState({
  provider,
  status,
  organizing,
  onProviderChange,
  onOrganize,
  onCancel,
}: Props) {
  return (
    <section className="organization-empty-state" aria-labelledby="organization-title">
      <div className="organization-empty-content">
        <Layers size={28} className="organization-empty-icon" aria-hidden="true" />
        <h2 id="organization-title">Organize changes into groups</h2>
        <p>Choose Claude or Codex, then organize this PR to start reviewing.</p>
        <fieldset className="organization-providers" disabled={organizing}>
          <legend className="sr-only">Coding provider</legend>
          {[
            { value: Provider.claude, label: 'Claude', Logo: ClaudeAI },
            { value: Provider.codex, label: 'Codex', Logo: OpenAI },
          ].map(({ value, label, Logo }) => (
            <label className="organization-provider" key={value}>
              <input
                type="radio"
                name="organization-provider"
                value={value}
                checked={provider === value}
                disabled={status && !status[value].available}
                onChange={() => onProviderChange(value)}
              />
              <span>
                <Logo width={20} height={20} aria-hidden="true" />
                {label}
                {status && !status[value].available && <small>Not installed</small>}
              </span>
            </label>
          ))}
        </fieldset>
        <Button
          disabled={organizing || (status && !status[provider].available)}
          onClick={onOrganize}
        >
          {organizing && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
          {organizing ? 'Organizing…' : 'Organize changes'}
        </Button>
        {organizing && <span role="status">Creating review groups. This may take a moment.</span>}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  )
}
