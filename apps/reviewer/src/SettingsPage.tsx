import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { ThemePicker } from './ThemePicker'
import { LanguageServerSettings } from './LanguageServerSettings'
import { OrganizationSettings } from './OrganizationSettings'
import type { AppStatus } from '../shared/types'
import type { OrganizationPreferences } from '../shared/preferences'

export function SettingsPage({
  inboxUrl,
  organization,
  status,
  onSave,
}: {
  inboxUrl: string
  organization?: OrganizationPreferences
  status?: AppStatus
  onSave: (organization: OrganizationPreferences) => Promise<void>
}) {
  return (
    <div className="settings-content">
      <Link className="back-to-inbox" to={inboxUrl}>
        <ArrowLeft size={14} /> Back to homepage
      </Link>
      <h1>Settings</h1>
      <section className="settings-section" aria-labelledby="organization-settings-title">
        <h2 id="organization-settings-title">PR organization</h2>
        <p className="muted">
          Choose the provider and model that group changes when you open a PR.
        </p>
        <OrganizationSettings organization={organization} status={status} onSave={onSave} />
      </section>
      <LanguageServerSettings />
      <section className="settings-section" aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <p className="muted">Choose the colors used throughout the app and in code diffs.</p>
        <ThemePicker />
      </section>
    </div>
  )
}
