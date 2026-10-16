import { Check, Copy } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { useClipboard } from '../lib/useClipboard'

export function CopyButton({ label, text }: { label: string; text: string }) {
  const { state, copy } = useClipboard()
  return (
    <Button size="sm" variant="ghost" onClick={() => void copy(text)}>
      {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  )
}
