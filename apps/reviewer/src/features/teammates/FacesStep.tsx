import { useState, type DragEvent } from 'react'
import { Button } from '~/components/ui/button'
import { teammateAvatarUrl } from '../../../shared/api/teammates'
import { avatarFallback, moods, type Mood, type Teammate } from '../../../shared/domain/teammates'
import { ReviewerFace } from '../../components/ReviewerFace'
import { message } from '../../lib/api'
import { ACCEPTED_AVATAR_TYPES, avatarFromFile } from './avatarImage'
import type { FaceChange, WizardDraft } from './useTeammateWizard'

const moodHints: Record<Mood, string> = {
  neutral: 'Explaining a finding',
  happy: 'Nothing to change',
  thinking: 'Reviewing',
  angry: 'A must-fix finding',
  resigned: 'The review failed',
}

/** Step three: a face per mood. Empty moods borrow neutral, then any face; none shows initials. */
export function FacesStep({
  name,
  saved,
  faces,
  setFace,
}: {
  name: string
  saved?: Teammate
  faces: WizardDraft['faces']
  setFace: (mood: Mood, face: FaceChange | undefined) => void
}) {
  const [error, setError] = useState('')
  const shown = moods.filter((mood) =>
    faces[mood] === undefined ? saved?.avatars.includes(mood) : faces[mood] !== null,
  )
  function previewOf(mood: Mood): string | undefined {
    const source = avatarFallback(shown, mood)
    if (!source) return undefined
    const face = faces[source]
    if (face) return face.preview
    return saved && teammateAvatarUrl(saved.id, source, saved.updatedAt)
  }
  async function pick(mood: Mood, file: File | undefined) {
    if (!file) return
    setError('')
    try {
      setFace(mood, await avatarFromFile(file))
    } catch (cause) {
      setError(message(cause))
    }
  }
  return (
    <div className="teammate-step">
      <p className="muted">
        Drop an image on a mood, or choose a file. One face is enough: moods without their own use
        neutral, then any face you added. Without any, {name || 'the teammate'} shows initials.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="teammate-faces">
        {moods.map((mood) => (
          <FaceSlot
            key={mood}
            mood={mood}
            name={name}
            preview={previewOf(mood)}
            own={shown.includes(mood)}
            onPick={(file) => void pick(mood, file)}
            onRemove={() => {
              setFace(mood, saved?.avatars.includes(mood) ? null : undefined)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function FaceSlot({
  mood,
  name,
  preview,
  own,
  onPick,
  onRemove,
}: {
  mood: Mood
  name: string
  preview?: string
  own: boolean
  onPick: (file: File | undefined) => void
  onRemove: () => void
}) {
  const [over, setOver] = useState(false)
  function drop(event: DragEvent) {
    event.preventDefault()
    setOver(false)
    onPick(event.dataTransfer.files[0])
  }
  return (
    <div
      className={`teammate-face${over ? ' teammate-face-over' : ''}${own ? '' : ' teammate-face-borrowed'}`}
    >
      <label
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => {
          setOver(false)
        }}
        onDrop={drop}
      >
        <ReviewerFace name={name || '?'} src={preview} size={72} />
        <strong>{mood}</strong>
        <span className="muted">{own ? moodHints[mood] : 'Uses another face'}</span>
        <input
          type="file"
          className="sr-only"
          accept={ACCEPTED_AVATAR_TYPES}
          aria-label={`Choose the ${mood} face`}
          onChange={(event) => {
            onPick(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </label>
      {own && (
        <Button size="xs" variant="ghost" onClick={onRemove} aria-label={`Remove the ${mood} face`}>
          Remove
        </Button>
      )}
    </div>
  )
}
