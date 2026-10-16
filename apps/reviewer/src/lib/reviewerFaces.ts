import { teammateAvatarUrl } from '../../shared/api/teammates'
import { builtInReviewers, reviewerTeammate, type BuiltInReviewer } from '../../shared/domain/panel'
import { avatarFallback, type Mood, type Teammate } from '../../shared/domain/teammates'

/** Where a reviewer's face for `mood` loads from, or undefined to show their initials. */
export function reviewerFaceSrc(
  id: string,
  mood: Mood,
  teammates: readonly Teammate[] = [],
): string | undefined {
  const teammateId = reviewerTeammate(id)
  if (!teammateId) {
    if (!Object.hasOwn(builtInReviewers, id)) return undefined
    const face = builtInReviewers[id as BuiltInReviewer].face
    return face && `${face}/${mood}.png`
  }
  const teammate = teammates.find((entry) => entry.id === teammateId)
  const shown = teammate && avatarFallback(teammate.avatars, mood)
  return shown && teammateAvatarUrl(teammate.id, shown, teammate.updatedAt)
}
