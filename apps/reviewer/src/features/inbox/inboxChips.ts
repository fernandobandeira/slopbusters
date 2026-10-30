import type { InboxPull } from '../../../shared/domain/types'
import { pullStatusGroup, type PullStatusGroup } from './inboxStatus'

type StatusChip = Exclude<PullStatusGroup, 'actions' | 'unknown'>
/** A filter on the PR list: a trait every shown PR has, or one of the statuses it may be in. */
export type InboxChip = 'draft' | 'no-panel' | StatusChip

export const inboxChips: { id: InboxChip; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'no-panel', label: 'No panel review' },
  { id: 'conflicts', label: 'Merge conflicts' },
  { id: 'comments', label: 'Unresolved comments' },
  { id: 'failing-ci', label: 'Failing CI' },
  { id: 'reviews', label: 'Needs review' },
  { id: 'pending-checks', label: 'Checks pending' },
  { id: 'ready', label: 'Ready to merge' },
]

/** Trait chips narrow the list together; the other chips are statuses and widen each other. */
const traitChips: readonly InboxChip[] = ['draft', 'no-panel']

/** What a chip asks of a PR beyond its own fields. */
export interface ChipContext {
  /** The panel reviewed the PR's current head, or is reviewing it now. */
  panelReviewed: (pull: InboxPull) => boolean
}

/**
 * The PRs the chips let through: every trait chip must hold, and when any status chip is on, the
 * PR must be in one of those statuses.
 */
export function filterByChips(
  pulls: InboxPull[],
  chips: readonly InboxChip[],
  context: ChipContext,
): InboxPull[] {
  const traits = chips.filter((chip) => traitChips.includes(chip))
  const statuses = chips.filter((chip) => !traitChips.includes(chip))
  return pulls.filter(
    (pull) =>
      traits.every((chip) => matches(pull, chip, context)) &&
      (!statuses.length || statuses.some((chip) => matches(pull, chip, context))),
  )
}

/** How many of these PRs a chip alone would show. */
export function chipCount(pulls: InboxPull[], chip: InboxChip, context: ChipContext): number {
  return pulls.filter((pull) => matches(pull, chip, context)).length
}

/** Newest first by when the PR was opened, so rows stay put as PRs change. */
export function byOpenedDate(pulls: InboxPull[]): InboxPull[] {
  return [...pulls].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.number - left.number,
  )
}

/** The chips saved in the inbox URL's `only` parameter, in chip order. */
export function readInboxChips(search: string): InboxChip[] {
  const saved = new URLSearchParams(search).get('only')?.split(',') ?? []
  return inboxChips.map((chip) => chip.id).filter((id) => saved.includes(id))
}

export function toggleChip(chips: readonly InboxChip[], chip: InboxChip): InboxChip[] {
  const next = chips.includes(chip) ? chips.filter((item) => item !== chip) : [...chips, chip]
  return inboxChips.map((item) => item.id).filter((id) => next.includes(id))
}

function matches(pull: InboxPull, chip: InboxChip, context: ChipContext): boolean {
  if (chip === 'draft') return pull.isDraft
  if (chip === 'no-panel') return !context.panelReviewed(pull)
  return pullStatusGroup(pull) === chip
}
