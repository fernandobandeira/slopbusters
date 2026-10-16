import type { ReviewerId } from '../../../shared/domain/panel'

const SELECTION_KEY = 'slopbusters:panel-reviewers'
const DEFAULT_SELECTION: ReviewerId[] = ['unclebob', 'rules']

/** The reviewers the user last asked; Uncle Bob and Rules until they choose. */
export function savedPanelSelection(): ReviewerId[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null')
    return Array.isArray(saved) && saved.length && saved.every((id) => typeof id === 'string')
      ? (saved as ReviewerId[])
      : DEFAULT_SELECTION
  } catch {
    return DEFAULT_SELECTION
  }
}

export function savePanelSelection(selection: ReviewerId[]) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection))
  } catch {
    /* The picker still works without browser storage. */
  }
}
