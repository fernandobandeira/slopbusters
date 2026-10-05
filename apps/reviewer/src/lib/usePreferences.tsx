import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react'
import * as routes from '../../shared/api'
import type { Preferences, OrganizationPreferences } from '../../shared/domain/preferences'
import { call } from './api'
import { useApiQuery } from './useApiQuery'

const PreferencesContext = createContext<
  | {
      preferences?: Preferences
      preferencesError: string
      save: (changes: Preferences) => Promise<Preferences>
      reload: () => void
    }
  | undefined
>(undefined)

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { data, error, setData, reload } = useApiQuery(routes.getPreferences, {})
  const save = useCallback(
    async (changes: Preferences) => {
      const result = await call(routes.savePreferences, { body: changes })
      setData(result)
      return result
    },
    [setData],
  )
  const value = useMemo(
    () => ({
      preferences: data,
      preferencesError: error ?? '',
      save,
      reload: reload,
    }),
    [data, error, reload, save],
  )
  return <PreferencesContext value={value}>{children}</PreferencesContext>
}

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (!context) throw new Error('PreferencesProvider is missing from the application root.')
  return {
    ...context,
    saveOrganization: async (organization: OrganizationPreferences) => {
      await context.save({ organization })
    },
    saveCompanion: async (companion: OrganizationPreferences) => {
      await context.save({ companion })
    },
  }
}
