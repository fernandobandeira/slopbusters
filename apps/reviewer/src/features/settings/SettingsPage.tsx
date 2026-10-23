import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ThemePicker } from './ThemePicker'
import { LanguageServerSettings } from './LanguageServerSettings'
import { ReviewWorkspaceSettings } from './ReviewWorkspaceSettings'
import { LinearSettings } from './LinearSettings'
import { OrganizationSettings } from './OrganizationSettings'
import type { AppStatus } from '../../../shared/domain/types'
import type { OrganizationPreferences } from '../../../shared/domain/preferences'

export function SettingsPage({
  inboxUrl,
  organization,
  status,
  onSave,
  teammates,
}: {
  inboxUrl: string
  organization?: OrganizationPreferences
  status?: AppStatus
  onSave: (organization: OrganizationPreferences) => Promise<void>
  /** The Teammates section, composed by the app. */
  teammates?: ReactNode
}) {
  return (
    <div className="settings-content">
      <Link className="back-to-inbox" to={inboxUrl}>
        <ArrowLeft size={14} /> Back to homepage
      </Link>
      <h1>Settings</h1>
      <section className="settings-section" aria-labelledby="organization-settings-title">
        <h2 id="organization-settings-title">Primary provider</h2>
        <p className="muted">
          Groups PR changes, leads Linus’s conversation, and reconciles both reviewers’
          recommendations. The other provider reviews alongside it.
        </p>
        <OrganizationSettings organization={organization} status={status} onSave={onSave} />
      </section>
      {teammates}
      <LinearSettings />
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
