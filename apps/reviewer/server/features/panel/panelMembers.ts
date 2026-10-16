import {
  builtInReviewers,
  reviewerTeammate,
  type BuiltInReviewer,
  type PanelReviewer,
  type ReviewerId,
} from '../../../shared/domain/panel'
import { DEFAULT_TEAMMATE_FINDINGS, installedFor } from '../../../shared/domain/teammates'
import type { Provider } from '../../../shared/domain/types'
import { UserError } from '../../errors'
import { MAX_PANEL_REVIEWERS } from '../../limits'
import type { Teammates } from '../teammates/teammates'
import type { PanelMember } from './panelReview'

const MAX_DESCRIPTION_CHARACTERS = 240

/** Who can sit on a panel: the built-in reviewers and every teammate installed for the model. */
export class PanelMembers {
  constructor(
    private readonly options: {
      teammates: Teammates
      builtIn: (reviewer: BuiltInReviewer) => Promise<string>
    },
  ) {}

  /** The reviewers a panel will run, checked before it starts so a missing skill fails early. */
  async describe(ids: readonly ReviewerId[], provider: Provider): Promise<PanelReviewer[]> {
    if (new Set(ids).size !== ids.length) throw new UserError('Pick each reviewer only once.')
    if (!ids.length || ids.length > MAX_PANEL_REVIEWERS)
      throw new UserError(`Pick between 1 and ${String(MAX_PANEL_REVIEWERS)} reviewers.`)
    return Promise.all(ids.map((id) => this.reviewer(id, provider)))
  }

  /** A reviewer's instructions as of now; a teammate whose skill was uninstalled fails here. */
  async load(reviewer: PanelReviewer, provider: Provider): Promise<PanelMember> {
    const teammate = reviewerTeammate(reviewer.id)
    if (!teammate)
      return {
        ...reviewer,
        instructions: await this.options.builtIn(reviewer.id as BuiltInReviewer),
      }
    const skill = await this.options.teammates.skill(teammate, provider)
    return { ...reviewer, instructions: skill.text, directory: skill.directory }
  }

  /** A chat continues a reviewer through its installed skill, so the chat's provider needs it. */
  async requireChat(reviewer: PanelReviewer, provider: Provider): Promise<void> {
    const teammateId = reviewerTeammate(reviewer.id)
    if (!teammateId) return
    const teammate = await this.options.teammates.get(teammateId)
    if (!installedFor(teammate.locations, provider))
      throw new UserError(
        `${teammate.name}'s skill, ${teammate.skill}, is not installed for your primary model's provider, so a chat cannot continue as ${teammate.name}.`,
      )
  }

  private async reviewer(id: ReviewerId, provider: Provider): Promise<PanelReviewer> {
    const teammateId = reviewerTeammate(id)
    if (!teammateId) {
      const builtIn = builtInReviewers[id as BuiltInReviewer]
      return {
        id,
        name: builtIn.name,
        description: builtIn.description,
        maxFindings: DEFAULT_TEAMMATE_FINDINGS,
      }
    }
    const teammate = await this.options.teammates.get(teammateId)
    if (!installedFor(teammate.locations, provider))
      throw new UserError(
        `${teammate.name}'s skill, ${teammate.skill}, is not installed for your primary model's provider. Install it there or choose another primary model in Settings.`,
      )
    const description = teammate.title ?? teammate.description
    return {
      id,
      name: teammate.name,
      skill: teammate.skill,
      maxFindings: teammate.maxFindings,
      ...(description ? { description: description.slice(0, MAX_DESCRIPTION_CHARACTERS) } : {}),
    }
  }
}
