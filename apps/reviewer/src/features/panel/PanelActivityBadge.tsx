import { Clock, LoaderCircle, Users } from 'lucide-react'
import { Button } from '~/components/ui/button'
import type { ActivePanel } from '../../../shared/domain/panel'
import './panel.css'

/** A PR's unfinished panel in the PR list: queued, reviewing, waiting on you, or stopped. */
export function PanelActivityBadge({ panel, onOpen }: { panel: ActivePanel; onOpen: () => void }) {
  const label = activityLabel(panel)
  return (
    <Button
      className={`panel-activity panel-activity-${panel.queued ? 'queued' : panel.status}`}
      size="xs"
      variant="outline"
      aria-label={`Open the review panel on PR #${String(panel.number)}. ${label}. ${panel.progress}`}
      title={panel.progress}
      onClick={onOpen}
    >
      {panel.queued ? (
        <Clock size={12} aria-hidden="true" />
      ) : panel.status === 'running' ? (
        <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
      ) : (
        <Users size={12} aria-hidden="true" />
      )}
      {label}
    </Button>
  )
}

function activityLabel(panel: ActivePanel): string {
  if (panel.queued) return 'Panel queued'
  if (panel.status === 'running') return 'Panel reviewing'
  if (panel.status === 'partial') return 'Panel needs you'
  return 'Panel stopped'
}
