import { useId, useState, type FormEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Provider, type AppStatus } from '../../../shared/domain/types'
import {
  modelFor,
  providerLabel,
  providerModels,
  type OrganizationPreferences,
} from '../../../shared/domain/preferences'
import { OpenAI, ClaudeAI } from '~/components/Icons'
import { Button } from '~/components/ui/button'
import { message } from '../../lib/api'

export function OrganizationSettings({
  organization,
  status,
  onSave,
  firstRun = false,
}: {
  organization?: OrganizationPreferences
  status?: AppStatus
  onSave: (organization: OrganizationPreferences) => Promise<void>
  firstRun?: boolean
}) {
  const id = useId()
  const [provider, setProvider] = useState(organization?.provider ?? Provider.codex)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await onSave(modelFor(provider))
      setSaved(true)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setSaving(false)
    }
  }
  return (
    <form className="organization-settings" onSubmit={(event) => void save(event)}>
      <fieldset className="organization-providers" disabled={saving}>
        <legend className="sr-only">Coding provider</legend>
        {[
          { value: Provider.codex, Logo: OpenAI },
          { value: Provider.claude, Logo: ClaudeAI },
        ].map(({ value, Logo }) => (
          <label className="organization-provider" key={value}>
            <input
              type="radio"
              name={`${id}-provider`}
              value={value}
              checked={provider === value}
              onChange={() => {
                setProvider(value)
                setSaved(false)
              }}
            />
            <span>
              <Logo width={20} height={20} aria-hidden="true" />
              {providerLabel(value)}
              {status && !status[value].available && <small>Not installed</small>}
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted">
        Reviews run on {providerModels.codex.review.label} and {providerModels.claude.review.label}.{' '}
        {providerModels.codex.judge.label} and {providerModels.claude.judge.label} check panel
        findings against the code.
      </p>
      {status && (!status[provider].available || status[provider].authenticated === false) && (
        <p role="status" className="inbox-warning">
          Install and sign in to {providerLabel(provider)} in your terminal before running a review.
        </p>
      )}
      {error && <p role="alert">Could not save your preferences: {error}</p>}
      {saved && <p role="status">Preferences saved.</p>}
      <Button type="submit" disabled={saving}>
        {saving && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
        {saving ? 'Saving…' : firstRun ? 'Get started' : 'Save preferences'}
      </Button>
    </form>
  )
}
