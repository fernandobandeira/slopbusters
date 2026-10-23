import { z } from 'zod'
import { Provider } from './types'

/** The five faces every reviewer can show, matching the built-in personas' portraits. */
export const moods = ['happy', 'neutral', 'resigned', 'angry', 'thinking'] as const
export const moodSchema = z.enum(moods)
export type Mood = z.infer<typeof moodSchema>

/** An installed skill's folder name: what Claude Code and Codex invoke it by. */
export const skillNameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)

export const teammateIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

/**
 * A teammate returns its most likely findings in rank order up to this many; the grounding stage
 * checks them, so recall comes first. Teammates saved with a smaller cap keep it until changed.
 */
export const DEFAULT_TEAMMATE_FINDINGS = 40
export const MAX_TEAMMATE_FINDINGS = 40

/** What the wizard asks for; the id is derived from the name when the teammate is created. */
export const teammateInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    title: z.string().trim().max(80).optional(),
    skill: skillNameSchema,
    maxFindings: z.number().int().min(1).max(MAX_TEAMMATE_FINDINGS),
  })
  .strict()
export type TeammateInput = z.infer<typeof teammateInputSchema>

/** A teammate as stored in `<data>/teammates/<id>/teammate.json`. */
export const teammateRecordSchema = teammateInputSchema
  .extend({ id: teammateIdSchema, updatedAt: z.string() })
  .strict()
export type TeammateRecord = z.infer<typeof teammateRecordSchema>

/** Which agents have a skill installed, and where its folder is for each. */
export const skillLocationsSchema = z
  .object({ claude: z.string().optional(), codex: z.string().optional() })
  .strict()
export type SkillLocations = z.infer<typeof skillLocationsSchema>

export const installedSkillSchema = z.object({
  name: skillNameSchema,
  description: z.string(),
  locations: skillLocationsSchema,
  /** Why the skill cannot back a teammate, such as a folder whose frontmatter names another skill. */
  problem: z.string().optional(),
  /** The teammate already built on this skill. */
  takenBy: teammateIdSchema.optional(),
})
export type InstalledSkill = z.infer<typeof installedSkillSchema>

export const teammateSchema = teammateRecordSchema.extend({
  description: z.string().optional(),
  locations: skillLocationsSchema,
  /** Moods with an uploaded face; the others fall back to neutral, then to any face. */
  avatars: z.array(moodSchema),
})
export type Teammate = z.infer<typeof teammateSchema>

export type SkillAvailability = 'both' | 'claude' | 'codex' | 'missing'

export function skillAvailability(locations: SkillLocations): SkillAvailability {
  if (locations.claude && locations.codex) return 'both'
  if (locations.claude) return 'claude'
  if (locations.codex) return 'codex'
  return 'missing'
}

export const availabilityLabels: Record<SkillAvailability, string> = {
  both: 'Claude and Codex',
  claude: 'Claude only',
  codex: 'Codex only',
  missing: 'Not installed',
}

/** Whether a teammate can review with the given provider. */
export function installedFor(locations: SkillLocations, provider: Provider): boolean {
  return Boolean(provider === Provider.claude ? locations.claude : locations.codex)
}

/** A lowercase slug of the display name, used as the teammate's id. */
export function teammateId(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

/** Up to two initials for a face that has no image. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : [name.trim()]
  return letters
    .map((word) => word?.[0] ?? '')
    .join('')
    .toUpperCase()
}

/** The mood to show when `wanted` has no face: neutral, then the first face uploaded. */
export function avatarFallback(available: readonly Mood[], wanted: Mood): Mood | undefined {
  if (available.includes(wanted)) return wanted
  if (available.includes('neutral')) return 'neutral'
  return moods.find((mood) => available.includes(mood))
}
