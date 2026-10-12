import { Menu } from '@base-ui/react/menu'
import { Check, ChevronDown, LoaderCircle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import * as routes from '../../../shared/api/chat'
import type { PullChatRequest } from '../../../shared/domain/chat'
import type { PullStatus } from '../../../shared/domain/pullStatus'
import { call } from '../../lib/api'
import { chatDetail, chatPlace, useChatStart } from './useChatStart'
import '../../components/startReview.css'

type Choice = 'linus' | 'unclebob' | 'gandalf-conflicts' | 'gandalf-ci'

const choices: Record<
  Choice,
  { name: string; icon: string; detail: string; request: PullChatRequest }
> = {
  linus: {
    name: 'Linus',
    icon: '/linus/neutral.png',
    detail: 'PR scope, title and description',
    request: { persona: 'linus' },
  },
  unclebob: {
    name: 'Uncle Bob',
    icon: '/unclebob/neutral.png',
    detail: 'Code quality and readability',
    request: { persona: 'unclebob' },
  },
  'gandalf-conflicts': {
    name: 'Gandalf',
    icon: '/gandalf/neutral.png',
    detail: 'Resolve the merge conflicts',
    request: { persona: 'gandalf', task: 'conflicts' },
  },
  'gandalf-ci': {
    name: 'Gandalf',
    icon: '/gandalf/neutral.png',
    detail: 'Fix the failing CI checks',
    request: { persona: 'gandalf', task: 'ci' },
  },
}

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'startup_failure',
  'action_required',
  'error',
])

/**
 * Opens a conversation about this PR as a T3 Code thread, in the user's T3 Code when it can take
 * it and in Slopbusters' own engine otherwise. Gandalf appears when there is something to fix.
 */
export function PullChatMenu({
  pullId,
  number,
  status,
  onError,
}: {
  pullId: string
  number: number
  status: PullStatus | undefined
  onError: (error: string) => void
}) {
  const { starting, started, start } = useChatStart<Choice>(onError)
  const available = availableChoices(status)
  const label = starting
    ? `Opening ${choices[starting].name}…`
    : started
      ? `${choices[started.persona].name} is ${chatPlace(started.chat)}`
      : 'Chat'
  return (
    <Menu.Root>
      <Menu.Trigger
        render={<Button size="sm" variant="outline" />}
        disabled={Boolean(starting)}
        aria-label={`Chat about PR #${number}`}
        title={started ? chatDetail(started.chat) : 'Talk it through in a T3 Code thread'}
      >
        {starting ? <LoaderCircle size={13} className="animate-spin" /> : null}
        {started ? <Check size={13} aria-hidden="true" /> : null}
        <span aria-live="polite">{label}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="review-menu-positioner"
        >
          <Menu.Popup className="review-menu" aria-label={`Chat about PR #${number}`}>
            {available.map((choice) => (
              <Menu.Item
                key={choice}
                onClick={() =>
                  void start(choice, () =>
                    call(routes.startPullChat, {
                      params: { id: pullId },
                      body: choices[choice].request,
                    }),
                  )
                }
              >
                <strong>
                  <img className="review-companion-icon" src={choices[choice].icon} alt="" />
                  {choices[choice].name}
                </strong>
                <span>{choices[choice].detail}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function availableChoices(status: PullStatus | undefined): Choice[] {
  const result: Choice[] = ['linus', 'unclebob']
  if (status?.mergeable === 'CONFLICTING') result.push('gandalf-conflicts')
  if (status?.checks.some((check) => FAILED_CONCLUSIONS.has(check.conclusion ?? '')))
    result.push('gandalf-ci')
  return result
}
