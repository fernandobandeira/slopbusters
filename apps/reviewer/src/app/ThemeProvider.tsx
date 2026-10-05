import { usePreferences } from '../lib/usePreferences'
import { DiffRuntimeContext } from '~/hooks/useTheme'
import DiffsWorker from '../features/review/diff/diff.worker.ts?worker'
import { createResilientDiffWorker } from '../features/review/diff/resilientDiffWorker'
import { contextMenuToken } from '../features/review/diff/codeSymbols'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { message } from '../lib/api'
import { registerReviewFlusher } from '../lib/persistenceLifecycle'
import { createThemePreferenceWriter, DEFAULT_THEME, getTheme, isThemeId, loadThemePalette, type ThemeId, type ThemeType } from '../lib/themes'

interface ReviewerTheme {
  themeId: ThemeId
  resolvedTheme: ThemeType
  setTheme: (id: ThemeId) => void
  error: string | undefined
}

const createWorker = () => createResilientDiffWorker(() => new DiffsWorker())

const ThemeContext = createContext<ReviewerTheme | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { preferences, preferencesError, save } = usePreferences()
  const [selectionId, setThemeId] = useState<ThemeId>()
  const themeId = selectionId ?? (isThemeId(preferences?.theme) ? preferences.theme : DEFAULT_THEME)
  const [error, setError] = useState<string>()
  const selectedByUser = useRef(false)
  const latestSelection = useRef<ThemeId | undefined>(undefined)
  const selection = useRef(0)
  const writer = useMemo(() => createThemePreferenceWriter((theme) => save({ theme })), [save])

  useEffect(
    () =>
      registerReviewFlusher(async () => {
        if (latestSelection.current) await writer(latestSelection.current)
      }),
    [writer],
  )

  useEffect(() => {
    let active = true
    const type = getTheme(themeId).type
    const root = document.documentElement
    root.dataset.theme = themeId
    root.style.colorScheme = type
    root.classList.toggle('dark', type === 'dark')
    void loadThemePalette(themeId)
      .then((palette) => {
        if (!active) return
        for (const [property, value] of Object.entries(palette))
          root.style.setProperty(property, value)
      })
      .catch((cause: unknown) => {
        if (active) setError(`Could not load this theme: ${message(cause)}`)
      })
    return () => {
      active = false
    }
  }, [themeId])

  const setTheme = useCallback(
    (id: ThemeId) => {
      latestSelection.current = id
      selectedByUser.current = true
      const current = ++selection.current
      setThemeId(id)
      setError(undefined)
      void writer(id).catch((cause: unknown) => {
        if (selection.current === current) setError(`Theme could not be saved: ${message(cause)}`)
      })
    },
    [writer],
  )

  const value = useMemo(
    () => ({
      themeId,
      resolvedTheme: getTheme(themeId).type,
      setTheme,
      error: error ?? (preferencesError || undefined),
    }),
    [themeId, setTheme, error, preferencesError],
  )
  const runtime = useMemo(() => ({ themeId, createWorker, contextMenuToken }), [themeId])
  return (
    <ThemeContext value={value}>
      <DiffRuntimeContext value={runtime}>{children}</DiffRuntimeContext>
    </ThemeContext>
  )
}

export function useReviewerTheme(): ReviewerTheme {
  const theme = useContext(ThemeContext)
  if (!theme) throw new Error('ThemeProvider is missing from the application root')
  return theme
}
