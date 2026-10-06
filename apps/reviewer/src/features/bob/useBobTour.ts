import { useState } from 'react'
import type { BobResult, BobSession } from '../../../shared/domain/bob'
import type { PullRequest } from '../../../shared/domain/types'

export function useBobTour(pull: PullRequest, session?: BobSession) {
  const [cursor, setCursor] = useState<{ fingerprint: string; index: number }>()
  const result = session?.results.find((result) => result.pull.url === pull.url)
  const key = `slopbusters:bob-tour:${session?.id ?? ''}:${pull.url}`
  const stored = savedCursor(key)
  const selected = cursor?.fingerprint === result?.fingerprint ? (cursor?.index ?? stored) : stored
  const index = result ? Math.min(result.advice.findings.length, Math.max(0, selected)) : 0
  function advance(index: number) {
    if (!result) return
    setCursor({ fingerprint: result.fingerprint, index })
    try {
      localStorage.setItem(key, String(index))
    } catch {
      /* The tour still works without browser storage. */
    }
  }
  return { result, index, advance, emotion: portraitEmotion(session, result, index) }
}
function savedCursor(key: string): number {
  try {
    const value = Number(localStorage.getItem(key) ?? 0)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}
function portraitEmotion(
  session: BobSession | undefined,
  result: BobResult | undefined,
  index: number,
) {
  if (session?.status === 'running') return 'thinking'
  if (session?.status === 'failed') return 'resigned'
  if (result?.advice.findings[index - 1]?.severity === 'must-fix') return 'angry'
  if (result?.advice.verdict === 'clean') return 'happy'
  return 'neutral'
}
