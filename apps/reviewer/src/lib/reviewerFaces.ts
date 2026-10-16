import { teammateAvatarUrl } from '../../shared/api/teammates'
import { builtInReviewers, reviewerTeammate, seatReviewer } from '../../shared/domain/panel'
import { avatarFallback, moods, type Mood, type Teammate } from '../../shared/domain/teammates'

/** The personas Slopbusters ships portraits for, each under `/<persona>/<mood>.png`. */
export const personas = {
  unclebob: { name: 'Uncle Bob', moods },
  linus: { name: 'Linus', moods },
  terminator: { name: 'Terminator', moods },
  jobs: { name: 'Steve Jobs', moods: ['neutral', 'thinking', 'happy', 'angry'] },
  gandalf: { name: 'Gandalf', moods: ['neutral', 'thinking', 'happy', 'angry'] },
} as const satisfies Record<string, { name: string; moods: readonly Mood[] }>
export type Persona = keyof typeof personas

/** A persona's portrait for `mood`, or its neutral one when it was not drawn with that mood. */
export function personaFaceSrc(persona: Persona, mood: Mood): string {
  const drawn: readonly Mood[] = personas[persona].moods
  return `/${persona}/${drawn.includes(mood) ? mood : 'neutral'}.png`
}

/** Where a reviewer's or seat's face for `mood` loads from, or undefined to show initials. */
export function reviewerFaceSrc(
  id: string,
  mood: Mood,
  teammates: readonly Teammate[] = [],
): string | undefined {
  const teammateId = reviewerTeammate(id)
  if (!teammateId) {
    const reviewer = seatReviewer(id)
    return Object.hasOwn(builtInReviewers, reviewer)
      ? personaFaceSrc(reviewer as Persona, mood)
      : undefined
  }
  const teammate = teammates.find((entry) => entry.id === teammateId)
  const shown = teammate && avatarFallback(teammate.avatars, mood)
  return shown && teammateAvatarUrl(teammate.id, shown, teammate.updatedAt)
}
