import { useEffect, useMemo, useState } from 'react'
import { message } from '../../lib/api'
import { registerReviewFlusher } from '../../lib/persistenceLifecycle'
import { usePreferences } from '../../lib/usePreferences'
import {
  createRepositoryHistoryWriter,
  loadRepositoryHistory,
  saveRepositoryHistory,
  visitRepository,
} from './repositoryHistory'

export function useRepositoryHistory(repository: string | undefined) {
  const { preferences, preferencesError, save } = usePreferences()
  const [state, setState] = useState(() => ({ history: loadRepositoryHistory(), restored: false }))
  const [historyError, setHistoryError] = useState('')
  const history =
    !state.restored && preferences
      ? (preferences.recentRepositories ?? state.history)
      : state.history
  const recentRepositories = repository ? visitRepository(history, repository) : history
  const restored = state.restored || Boolean(preferences)
  if (recentRepositories !== state.history || restored !== state.restored) {
    setState({ history: recentRepositories, restored })
  }
  const writer = useMemo(
    () => createRepositoryHistoryWriter((recentRepositories) => save({ recentRepositories })),
    [save],
  )

  useEffect(() => registerReviewFlusher(writer.flush), [writer])
  useEffect(() => {
    if (!restored) return
    saveRepositoryHistory(recentRepositories)
    void writer.write(recentRepositories).then(
      () => {
        setHistoryError('')
      },
      (cause: unknown) => {
        setHistoryError(`Could not save recent repositories: ${message(cause)}`)
      },
    )
  }, [recentRepositories, restored, writer])

  return {
    recentRepositories,
    historyLoading: !restored && !preferencesError,
    historyError,
  }
}
