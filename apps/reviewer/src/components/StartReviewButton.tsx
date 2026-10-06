import { Menu } from '@base-ui/react/menu'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import './startReview.css'

export type ReviewCompanion = 'bob' | 'linus'

export function StartReviewButton({
  number,
  busy = false,
  disabled = false,
  companion,
  onStart,
}: {
  number: number
  busy?: boolean
  disabled?: boolean
  companion?: ReviewCompanion
  onStart: (companion: ReviewCompanion) => void
}) {
  if (companion) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy || disabled}
        aria-label={`Start review of PR #${number}`}
        onClick={() => {
          onStart(companion)
        }}
      >
        {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
        {busy ? 'Starting…' : 'Start review'}
      </Button>
    )
  }
  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button size="sm" variant="outline" />}
        disabled={busy || disabled}
        aria-label={`Start review of PR #${number}`}
      >
        {busy ? <LoaderCircle size={13} className="animate-spin" /> : null}
        {busy ? 'Starting…' : 'Start review'}
        <ChevronDown size={12} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="review-menu-positioner"
        >
          <Menu.Popup className="review-menu" aria-label={`Review PR #${number}`}>
            <Menu.Item
              onClick={() => {
                onStart('bob')
              }}
            >
              <strong>Bob</strong>
              <span>Code quality and readability</span>
            </Menu.Item>
            <Menu.Item
              onClick={() => {
                onStart('linus')
              }}
            >
              <strong>Linus</strong>
              <span>PR scope and description</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
