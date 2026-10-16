import { teammateAvatarUrl } from '../../shared/api/teammates'
import {
  builtInReviewers,
  reviewerTeammate,
  seatReviewer,
  type BuiltInReviewer,
} from '../../shared/domain/panel'
import { avatarFallback, type Mood, type Teammate } from '../../shared/domain/teammates'

/** Where a reviewer's or seat's face for `mood` loads from, or undefined to show initials. */
export function reviewerFaceSrc(
  id: string,
  mood: Mood,
  teammates: readonly Teammate[] = [],
): string | undefined {
  const teammateId = reviewerTeammate(id)
  if (!teammateId) {
    const reviewer = seatReviewer(id)
    if (!Object.hasOwn(builtInReviewers, reviewer)) return undefined
    const face = builtInReviewers[reviewer as BuiltInReviewer].face
    return face && `${face}/${mood}.png`
  }
  const teammate = teammates.find((entry) => entry.id === teammateId)
  const shown = teammate && avatarFallback(teammate.avatars, mood)
  return shown && teammateAvatarUrl(teammate.id, shown, teammate.updatedAt)
}
