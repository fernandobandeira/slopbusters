import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api'
import type { PanelSession } from '../../../shared/domain/panel'
import { useApiQuery } from '../../lib/useApiQuery'
import { PanelStack } from './PanelStack'

/** The panel still working on this PR, with its reviewers' faces; opens the companion on it. */
export function ActivePanelButton({
  session,
  number,
  onOpen,
}: {
  session: PanelSession
  number: number
  onOpen: () => void
}) {
  const teammates = useApiQuery(routes.listTeammates, {}).data?.teammates
  const running = session.status === 'running'
  const label = running ? 'Panel reviewing…' : 'Panel needs you'
  return (
    <Button
      size="sm"
      variant="outline"
      aria-label={`Open the review panel on PR #${String(number)}. ${session.progress}`}
      title={session.progress}
      onClick={onOpen}
    >
      <PanelStack session={session} mood="neutral" teammates={teammates} compact />
      {label}
    </Button>
  )
}
