import { createContext, useContext } from 'react'
import type { DiffTokenEventBaseProps } from '@pierre/diffs'

export interface DiffRuntime {
  themeId: string
  createWorker: () => Worker
  contextMenuToken?: (event: MouseEvent) => DiffTokenEventBaseProps | undefined
}
export const DiffRuntimeContext = createContext<DiffRuntime>({
  themeId: 'github-light',
  createWorker: () => { throw new Error('Diff worker factory is missing from the application root.') },
})
export const useTheme = () => useContext(DiffRuntimeContext)
