import { z } from 'zod'
import {
  installedSkillSchema,
  moodSchema,
  teammateIdSchema,
  teammateInputSchema,
  teammateSchema,
  type Mood,
} from '../domain/teammates'
import { defineRoute, okSchema } from './contract'

const teammateParams = z.object({ id: teammateIdSchema }).strict()
export const avatarParams = z.object({ id: teammateIdSchema, mood: moodSchema }).strict()

export const listInstalledSkills = defineRoute('GET', '/skills', {
  response: z.object({ skills: z.array(installedSkillSchema) }),
})
export const listTeammates = defineRoute('GET', '/teammates', {
  response: z.object({ teammates: z.array(teammateSchema) }),
})
export const createTeammate = defineRoute('POST', '/teammates', {
  request: teammateInputSchema,
  response: teammateSchema,
})
export const updateTeammate = defineRoute('PUT', '/teammates/:id', {
  params: teammateParams,
  request: teammateInputSchema,
  response: teammateSchema,
})
export const removeTeammate = defineRoute('DELETE', '/teammates/:id', {
  params: teammateParams,
  response: okSchema,
})
/** A face for one mood, as a base64 PNG the browser already cropped and re-encoded. */
export const saveTeammateAvatar = defineRoute('PUT', '/teammates/:id/avatars/:mood', {
  params: avatarParams,
  request: z
    .object({
      png: z
        .string()
        .max(720_000)
        .regex(/^[A-Za-z0-9+/]+=*$/),
    })
    .strict(),
  response: teammateSchema,
})
export const removeTeammateAvatar = defineRoute('DELETE', '/teammates/:id/avatars/:mood', {
  params: avatarParams,
  response: teammateSchema,
})
/** The face itself, served as `image/png`; not JSON, so it is fetched by an `img` element. */
export const teammateAvatarPath = '/teammates/:id/avatars/:mood'

/** Where an `img` loads a teammate's face; `version` changes whenever a face does. */
export function teammateAvatarUrl(id: string, mood: Mood, version: string): string {
  return `/api/teammates/${encodeURIComponent(id)}/avatars/${mood}?v=${encodeURIComponent(version)}`
}
