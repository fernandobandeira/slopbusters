import { useId, useState, type FormEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Provider, type AppStatus } from '../../../shared/domain/types'
import {
  organizationDefaults,
  organizationSchema,
  providerLabel,
  type OrganizationPreferences,
} from '../../../shared/domain/preferences'
import { OpenAI, ClaudeAI } from '~/components/ProviderLogos'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { message } from '../../lib/api'

export function OrganizationSettings({
  organization,
  status,
  onSave,
  firstRun = false,
  companion = false,
}: {
  organization?: OrganizationPreferences
  status?: AppStatus
  onSave: (organization: OrganizationPreferences) => Promise<void>
  firstRun?: boolean
  companion?: boolean
}) {
  const id = useId()
  const [provider, setProvider] = useState(organization?.provider ?? Provider.codex)
  const [models, setModels] = useState(() => ({
    codex: organizationDefaults.codex.model,
    claude: organizationDefaults.claude.model,
    ...(organization && { [organization.provider]: organization.model }),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const model = models[provider]
  const valid = organizationSchema.safeParse({ provider, model }).success
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await onSave(organizationSchema.parse({ provider, model }))
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
      <label htmlFor={`${id}-model`}>Model</label>
      <Input
        id={`${id}-model`}
        value={model}
        disabled={saving}
        required
        maxLength={160}
        aria-describedby={`${id}-suggestion`}
        list={`${id}-models`}
        onChange={(event) => {
          setModels({ ...models, [provider]: event.target.value })
          setSaved(false)
        }}
      />
      <datalist id={`${id}-models`}>
        <option value={organizationDefaults[provider].model}>
          {organizationDefaults[provider].label}
        </option>
      </datalist>
      <p className="muted" id={`${id}-suggestion`}>
        Suggested: {organizationDefaults[provider].label}. Enter any model supported by{' '}
        {providerLabel(provider)}.
      </p>
      <p className="muted">
        {companion
          ? `The companion reviews independently. Your primary model reconciles both reviews and guides Linus’s conversation.`
          : `Your signed-in ${providerLabel(provider)} account groups PR changes, reviews with Linus, and reconciles the companion’s findings.`}
      </p>
      {status && (!status[provider].available || status[provider].authenticated === false) && (
        <p role="status" className="inbox-warning">
          Install and sign in to {providerLabel(provider)} in your terminal before running a review.
        </p>
      )}
      {error && <p role="alert">Could not save your preferences: {error}</p>}
      {saved && <p role="status">Preferences saved.</p>}
      <Button type="submit" disabled={!valid || saving}>
        {saving && <LoaderCircle size={14} className="animate-spin" aria-hidden="true" />}
        {saving ? 'Saving…' : firstRun ? 'Get started' : 'Save preferences'}
      </Button>
    </form>
  )
}
