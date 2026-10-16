import { useState } from 'react'
import type { JudgedFinding, PanelResult, PanelSession } from '../../../shared/domain/panel'
import type { Mood } from '../../../shared/domain/teammates'
import type { PullRequest } from '../../../shared/domain/types'

/** Where the user is in a panel result: the summary at 0, then one step per finding. */
export function usePanelTour(pull: PullRequest, session?: PanelSession) {
  const [cursor, setCursor] = useState<{ fingerprint: string; index: number }>()
  const result = session?.results.find((item) => item.pull.url === pull.url)
  const key = `slopbusters:panel-tour:${session?.id ?? ''}:${pull.url}`
  const stored = savedCursor(key)
  const selected = cursor?.fingerprint === result?.fingerprint ? (cursor?.index ?? stored) : stored
  const index = result ? Math.min(result.advice.findings.length, Math.max(0, selected)) : 0
  function advance(next: number) {
    if (!result) return
    setCursor({ fingerprint: result.fingerprint, index: next })
    try {
      localStorage.setItem(key, String(next))
    } catch {
      /* The tour still works without browser storage. */
    }
  }
  const finding = result?.advice.findings[index - 1]
  return { result, index, advance, finding, mood: tourMood(session, result, finding) }
}

function savedCursor(key: string): number {
  try {
    const value = Number(localStorage.getItem(key) ?? 0)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

/** The face the speaking reviewer shows: the same moods the built-in personas use. */
function tourMood(
  session: PanelSession | undefined,
  result: PanelResult | undefined,
  finding: JudgedFinding | undefined,
): Mood {
  if (session?.status === 'running') return 'thinking'
  if (session?.status === 'failed') return 'resigned'
  if (finding?.severity === 'must-fix') return 'angry'
  if (finding?.tag === 'decision') return 'thinking'
  if (result?.advice.verdict === 'clean') return 'happy'
  return 'neutral'
}
