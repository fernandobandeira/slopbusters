import {
  avatarFallback,
  installedFor,
  teammateId,
  type InstalledSkill,
  type Mood,
  type Teammate,
  type TeammateInput,
} from '../../../shared/domain/teammates'
import { Provider } from '../../../shared/domain/types'
import type { InstalledSkills } from '../../adapters/installedSkills'
import type { StoredTeammate, TeammateStore } from '../../adapters/teammateStore'
import { UserError } from '../../errors'

/** A teammate's skill, ready for a reviewer: its instructions and the folder its references are in. */
export interface TeammateSkill {
  text: string
  directory: string
}

/**
 * Teammates are the app's records of installed skills: a name, a title, a finding cap and faces.
 * The skill itself stays where Claude Code or Codex installed it and is only ever read.
 */
export class Teammates {
  constructor(
    private readonly store: TeammateStore,
    private readonly skills: InstalledSkills,
  ) {}

  async installedSkills(): Promise<InstalledSkill[]> {
    const [skills, teammates] = await Promise.all([this.skills.list(), this.store.list()])
    const owners = new Map(teammates.map((teammate) => [teammate.skill, teammate.id]))
    return skills.map((skill) => {
      const takenBy = owners.get(skill.name)
      return takenBy ? { ...skill, takenBy } : skill
    })
  }

  async list(): Promise<Teammate[]> {
    const [skills, teammates] = await Promise.all([this.skills.list(), this.store.list()])
    const byName = new Map(skills.map((skill) => [skill.name, skill]))
    return teammates.map((teammate) => present(teammate, byName.get(teammate.skill)))
  }

  async get(id: string): Promise<Teammate> {
    const teammate = await this.store.get(id)
    if (!teammate) throw new UserError('This teammate no longer exists.', 404)
    const skills = await this.skills.list()
    return present(
      teammate,
      skills.find((skill) => skill.name === teammate.skill),
    )
  }

  async create(input: TeammateInput): Promise<Teammate> {
    const id = teammateId(input.name)
    if (!id) throw new UserError('Give the teammate a name with at least one letter or number.')
    if (await this.store.get(id)) throw new UserError(`A teammate called ${input.name} exists.`)
    await this.requireUsableSkill(input.skill, id)
    await this.store.save({ ...input, id, updatedAt: new Date().toISOString() })
    return this.get(id)
  }

  async update(id: string, input: TeammateInput): Promise<Teammate> {
    await this.get(id)
    await this.requireUsableSkill(input.skill, id)
    await this.store.save({ ...input, id, updatedAt: new Date().toISOString() })
    return this.get(id)
  }

  async remove(id: string): Promise<void> {
    await this.get(id)
    await this.store.remove(id)
  }

  async saveAvatar(id: string, mood: Mood, base64: string): Promise<Teammate> {
    const teammate = await this.get(id)
    await this.store.saveAvatar(id, mood, Buffer.from(base64, 'base64'))
    await this.touch(teammate)
    return this.get(id)
  }

  async removeAvatar(id: string, mood: Mood): Promise<Teammate> {
    const teammate = await this.get(id)
    await this.store.removeAvatar(id, mood)
    await this.touch(teammate)
    return this.get(id)
  }

  /** The face for a mood, falling back to neutral and then to any face the teammate has. */
  async avatar(id: string, mood: Mood): Promise<Buffer | undefined> {
    const teammate = await this.store.get(id)
    const shown = teammate && avatarFallback(teammate.avatars, mood)
    return shown && this.store.avatar(id, shown)
  }

  /** The skill a teammate reviews with on `provider`, or a reason it cannot. */
  async skill(id: string, provider: Provider): Promise<TeammateSkill> {
    const teammate = await this.get(id)
    if (!installedFor(teammate.locations, provider))
      throw new UserError(
        `${teammate.name} uses the ${teammate.skill} skill, which is not installed for ${provider === Provider.claude ? 'Claude' : 'Codex'}. Install it there or switch your primary model in Settings.`,
      )
    const directory = await this.skills.directory(teammate.skill, provider)
    return { text: await this.skills.text(teammate.skill, provider), directory }
  }

  private async requireUsableSkill(name: string, id: string) {
    const skill = (await this.installedSkills()).find((entry) => entry.name === name)
    if (!skill) throw new UserError(`No skill called ${name} is installed for Claude or Codex.`)
    if (skill.problem) throw new UserError(`The ${name} skill cannot be used: ${skill.problem}`)
    if (skill.takenBy && skill.takenBy !== id)
      throw new UserError(`The ${name} skill already belongs to another teammate.`)
  }

  private async touch(teammate: Teammate) {
    const { name, title, skill, maxFindings, id } = teammate
    await this.store.save({
      id,
      name,
      skill,
      maxFindings,
      ...(title ? { title } : {}),
      updatedAt: new Date().toISOString(),
    })
  }
}

function present(teammate: StoredTeammate, skill?: InstalledSkill): Teammate {
  return {
    ...teammate,
    locations: skill && !skill.problem ? skill.locations : {},
    ...(skill?.description ? { description: skill.description } : {}),
  }
}
