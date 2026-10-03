import { LoaderCircle } from 'lucide-react'
import { Link } from 'react-router'
import { providerLabel, type OrganizationPreferences } from '../shared/preferences'
import { Button } from './vendor/t3/components/ui/button'

interface Props {
  organization?: OrganizationPreferences
  organizing: boolean
  failed?: boolean
  onOrganize?: () => void
  onCancel?: () => void
}

export function OrganizationEmptyState({
  organization,
  organizing,
  failed,
  onOrganize,
  onCancel,
}: Props) {
  return (
    <section
      className="organization-empty-state"
      aria-labelledby="organization-title"
      aria-busy={organizing}
    >
      <div className="organization-empty-content">
        {!failed && (
          <LoaderCircle
            size={32}
            className="animate-spin organization-empty-icon"
            aria-hidden="true"
          />
        )}
        <h2 id="organization-title">
          {failed
            ? 'Could not organize this PR'
            : organizing
              ? 'Organizing changes…'
              : 'Setting up your review…'}
        </h2>
        <p role="status">
          {failed
            ? 'Try again or update your provider and model in Settings.'
            : organizing && organization
              ? `${providerLabel(organization.provider)} is grouping related changes using ${organization.model}. This may take a moment.`
              : 'Choose your coding provider and model to get started.'}
        </p>
        {failed && onOrganize && <Button onClick={onOrganize}>Try again</Button>}
        {(failed || !organization) && <Link to="/settings">Open Settings</Link>}
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  )
}
