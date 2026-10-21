import { useState } from 'react'
import * as routes from '../../../shared/api'
import {
  DEFAULT_TEAMMATE_FINDINGS,
  moods,
  type Mood,
  type Teammate,
  type TeammateInput,
} from '../../../shared/domain/teammates'
import { call, message } from '../../lib/api'
import type { AvatarImage } from './avatarImage'

export const wizardSteps = ['Skill', 'Name', 'Faces'] as const

/** A face the user picked, or null to remove the one the teammate has. */
export type FaceChange = AvatarImage | null

export interface WizardDraft {
  skill?: string
  name: string
  title: string
  login: string
  maxFindings: number
  faces: Partial<Record<Mood, FaceChange>>
}

function initialDraft(teammate?: Teammate): WizardDraft {
  return {
    skill: teammate?.skill,
    name: teammate?.name ?? '',
    title: teammate?.title ?? '',
    login: teammate?.login ?? '',
    maxFindings: teammate?.maxFindings ?? DEFAULT_TEAMMATE_FINDINGS,
    faces: {},
  }
}

/**
 * The wizard's draft and its finish: save the teammate, then each face that changed. A teammate
 * created before a face failed to upload is edited, not created again, on the next try.
 */
export function useTeammateWizard(
  editing: Teammate | undefined,
  onDone: (teammate: Teammate) => void,
) {
  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState(() => initialDraft(editing))
  const [saved, setSaved] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function update(changes: Partial<WizardDraft>) {
    setDraft((previous) => ({ ...previous, ...changes }))
  }
  function setFace(mood: Mood, face: FaceChange | undefined) {
    setDraft((previous) => ({ ...previous, faces: { ...previous.faces, [mood]: face } }))
  }
  async function finish() {
    if (!draft.skill || saving) return
    setSaving(true)
    setError('')
    try {
      let teammate = await saveRecord(saved, teammateInput(draft, draft.skill))
      setSaved(teammate)
      teammate = await saveFaces(teammate, draft.faces)
      onDone(teammate)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setSaving(false)
    }
  }
  const ready = [Boolean(draft.skill), Boolean(draft.name.trim()), true]
  return { step, setStep, draft, update, setFace, finish, saving, error, ready, saved }
}

function teammateInput(draft: WizardDraft, skill: string): TeammateInput {
  const title = draft.title.trim()
  const login = draft.login.trim().replace(/^@/, '')
  return {
    name: draft.name.trim(),
    skill,
    maxFindings: draft.maxFindings,
    ...(title ? { title } : {}),
    ...(login ? { login } : {}),
  }
}

function saveRecord(saved: Teammate | undefined, body: TeammateInput) {
  return saved
    ? call(routes.updateTeammate, { params: { id: saved.id }, body })
    : call(routes.createTeammate, { body })
}

async function saveFaces(teammate: Teammate, faces: WizardDraft['faces']): Promise<Teammate> {
  let current = teammate
  for (const mood of moods) {
    const face = faces[mood]
    const params = { id: current.id, mood }
    if (face === null && current.avatars.includes(mood))
      current = await call(routes.removeTeammateAvatar, { params })
    else if (face)
      current = await call(routes.saveTeammateAvatar, { params, body: { png: face.png } })
  }
  return current
}
