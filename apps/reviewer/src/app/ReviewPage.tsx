import { useState, type ComponentProps } from 'react'
import type { PullStatusSection } from '../components/PullStatusIcons'
import { PullStatusDialog } from '../features/pull-status/PullStatusDialog'
import { usePullStatus } from '../features/pull-status/usePullStatus'
import { usePullUpdates } from '../features/pull-status/usePullUpdates'
import { ReviewWorkspace } from '../features/review/ReviewWorkspace'
import { SourceContextDialog } from '../features/source-navigation/SourceContextDialog'
import { SymbolContextMenu } from '../features/source-navigation/SymbolContextMenu'
import { StackDialog } from '../features/stacks/StackPanel'
import { usePullStack } from '../features/stacks/usePullStack'
import { readRoute } from '../lib/routes'

type Props = Omit<
  ComponentProps<typeof ReviewWorkspace>,
  | 'pullStatus'
  | 'updates'
  | 'stackSummary'
  | 'onStack'
  | 'onStatus'
  | 'renderSymbolMenu'
  | 'renderSourceDialog'
>

/** The review workspace with GitHub status, the PR's stack, and source navigation plugged in. */
export function ReviewPage(props: Props) {
  const { pull } = props
  const updates = usePullUpdates(pull)
  const { stack, summary: stackSummary } = usePullStack(pull)
  const [stackOpen, setStackOpen] = useState(false)
  const pullStatus = usePullStatus(pull.url, pull.id)
  const [statusOpen, setStatusOpen] = useState(false)
  const [statusSection, setStatusSection] = useState<PullStatusSection>()
  const inboxRoute = readRoute({
    pathname: window.location.pathname,
    search: window.location.search,
  })
  const inboxFilter = inboxRoute.kind === 'not-found' ? 'mine' : inboxRoute.filter
  return (
    <>
      <ReviewWorkspace
        {...props}
        pullStatus={pullStatus}
        updates={updates}
        stackSummary={stackSummary}
        onStack={() => {
          setStackOpen(true)
        }}
        onStatus={(section) => {
          setStatusSection(section)
          setStatusOpen(true)
        }}
        renderSymbolMenu={(menu) => <SymbolContextMenu {...menu} />}
        renderSourceDialog={(dialog) => <SourceContextDialog {...dialog} />}
      />
      <StackDialog
        url={stackOpen ? pull.url : undefined}
        stack={stack ?? undefined}
        currentNumber={pull.number}
        filter={inboxFilter}
        onClose={() => {
          setStackOpen(false)
        }}
      />
      <PullStatusDialog
        url={statusOpen ? pull.url : undefined}
        status={pullStatus.status}
        error={pullStatus.error}
        section={statusSection}
        snapshotHeadSha={pull.headSha}
        onClose={() => {
          setStatusOpen(false)
        }}
      />
    </>
  )
}
