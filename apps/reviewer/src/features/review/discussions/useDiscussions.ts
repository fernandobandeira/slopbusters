import { useCallback, useState } from 'react'
import * as routes from '../../../../shared/api'
import type { ReviewThread } from '../../../../shared/domain/types'
import { call, message } from '../../../lib/api'
import { useApiQuery } from '../../../lib/useApiQuery'

export function useDiscussions(pullId: string, setNotice: (notice: string) => void) {
  const query = useApiQuery(routes.getThreads, { params: { id: pullId } })
  const [refreshError, setRefreshError] = useState('')
  const refreshDiscussions = useCallback(async () => {
    const value = await call(routes.getThreads, { params: { id: pullId } })
    query.setData(value)
    setRefreshError('')
  }, [pullId, query.setData])
  const postReply = useCallback(
    async (thread: ReviewThread, body: string) => {
      await call(routes.replyToThread, {
        params: { id: pullId, threadId: thread.id },
        body: { body },
      })
      setNotice('Reply posted to GitHub.')
      void refreshDiscussions().catch((error: unknown) => {
        setRefreshError(message(error))
      })
    },
    [pullId, refreshDiscussions, setNotice],
  )
  return {
    discussions: query.data,
    discussionError: refreshError || query.error || '',
    refreshDiscussions,
    postReply,
    setDiscussionError: setRefreshError,
  }
}
