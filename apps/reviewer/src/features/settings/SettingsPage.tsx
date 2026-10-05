import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import { ThemePicker } from './ThemePicker'
import { LanguageServerSettings } from './LanguageServerSettings'
import { ReviewWorkspaceSettings } from './ReviewWorkspaceSettings'
import { OrganizationSettings } from './OrganizationSettings'
import { Provider, type AppStatus } from '../../../shared/domain/types'
import { organizationDefaults, type OrganizationPreferences } from '../../../shared/domain/preferences'

export function SettingsPage({
  inboxUrl,
  organization,
  companion,
  status,
  onSave,
  onSaveCompanion,
}: {
  inboxUrl: string
  organization?: OrganizationPreferences
  companion?: OrganizationPreferences
  status?: AppStatus
  onSave: (organization: OrganizationPreferences) => Promise<void>
  onSaveCompanion: (companion: OrganizationPreferences) => Promise<void>
}) {
  return (
    <div className="settings-content">
      <Link className="back-to-inbox" to={inboxUrl}>
        <ArrowLeft size={14} /> Back to homepage
      </Link>
      <h1>Settings</h1>
      <section className="settings-section" aria-labelledby="organization-settings-title">
        <h2 id="organization-settings-title">Primary model</h2>
        <p className="muted">
          Group PR changes, review with Linus, and reconcile both reviewers’ recommendations.
        </p>
        <OrganizationSettings organization={organization} status={status} onSave={onSave} />
      </section>
      <section className="settings-section" aria-labelledby="companion-settings-title">
        <h2 id="companion-settings-title">Companion model</h2>
        <p className="muted">Review alongside the primary model and challenge its reasoning.</p>
        <OrganizationSettings
          organization={
            companion ?? { provider: Provider.claude, model: organizationDefaults.claude.model }
          }
          status={status}
          onSave={onSaveCompanion}
          companion
        />
      </section>
      <LanguageServerSettings />
      <ReviewWorkspaceSettings />
      <section className="settings-section" aria-labelledby="appearance-title">
        <h2 id="appearance-title">Appearance</h2>
        <p className="muted">Choose the colors used throughout the app and in code diffs.</p>
        <ThemePicker />
      </section>
    </div>
  )
}
