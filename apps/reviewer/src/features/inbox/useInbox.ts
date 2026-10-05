import * as routes from '../../../shared/api'
import type { InboxFilter } from './inbox'
import { useApiQuery } from '../../lib/useApiQuery'

export function useInbox(
  repository: string,
  options: { filter: InboxFilter; refresh: number; enabled: boolean },
) {
  const { filter, refresh, enabled } = options
  const core = useApiQuery(
    routes.getInbox,
    { query: { repository } },
    { enabled: enabled && Boolean(repository), refresh },
  )
  const status = useApiQuery(
    routes.getInboxStatus,
    {
      query: {
        repository,
        filter: filter === 'mine' ? 'mine' : 'all',
        refresh: refresh ? '1' : '0',
      },
    },
    { enabled: enabled && Boolean(repository), refresh },
  )
  const statuses = new Map(status.data?.statuses.map((entry) => [entry.number, entry.status]))
  const inbox = core.data && {
    ...core.data,
    warnings: [
      ...(core.data.warnings ?? []),
      ...(status.data?.warnings ?? []),
      ...(status.error ? [`Could not load checks and review status: ${status.error}`] : []),
    ],
    pulls: core.data.pulls.map((pull) => {
      const current = statuses.get(pull.number)
      return { ...pull, status: current?.headSha === pull.headSha ? current : pull.status }
    }),
  }
  return {
    inbox,
    inboxLoading: core.loading,
    inboxError: core.error,
    inboxStatusLoading: status.loading,
  }
}
