import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '~/lib/utils'

// Extracted from T3 Code f391794a; interactive tooltip actions are omitted.
export function TimelineSystemDivider(props: {
  label: string
  detail?: ReactNode
  tone?: 'neutral' | 'danger'
  icon?: LucideIcon
}) {
  const Icon = props.icon
  return (
    <div className={cn('flex min-w-0 items-center gap-2 py-2 text-xs text-muted-foreground', props.tone === 'danger' && 'text-destructive')}>
      <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
      <span className="flex min-w-0 flex-wrap items-center justify-center gap-1.5 rounded-full px-2 py-1">
        {Icon && <Icon className="size-3 shrink-0" />}
        <span className="font-medium">{props.label}</span>
        {props.detail && <span className="min-w-0 opacity-70">· {props.detail}</span>}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border/70" />
    </div>
  )
}
