import { useCallback, useEffect, useState } from 'react'

export function useClipboard() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state === 'idle') return
    const timer = setTimeout(() => {
      setState('idle')
    }, 2500)
    return () => {
      clearTimeout(timer)
    }
  }, [state])
  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
      return true
    } catch {
      setState('failed')
      return false
    }
  }, [])
  return {
    state,
    copy,
    reset: useCallback(() => {
      setState('idle')
    }, []),
  }
}
