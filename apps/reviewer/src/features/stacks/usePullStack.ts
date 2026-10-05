import * as routes from '../../../shared/api'
import type { PullRequest } from '../../../shared/domain/types'
import { stackSummary } from '../../../shared/domain/stacks'
import { useApiQuery } from '../../lib/useApiQuery'

export function usePullStack(pull: PullRequest) {
  const query = useApiQuery(routes.getStackByUrl, { query: { url: pull.url } })
  const data = query.data
  return { stack: data?.stack, summary: data?.stack ? stackSummary(data.stack) : data?.summary }
}
