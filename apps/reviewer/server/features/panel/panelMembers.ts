import {
  builtInReviewers,
  reviewerTeammate,
  seatReviewer,
  type BuiltInReviewer,
  type PanelReviewer,
  type PanelSeatRequest,
  type ReviewerId,
} from '../../../shared/domain/panel'
import { modelForProvider, type OrganizationPreferences } from '../../../shared/domain/preferences'
import { DEFAULT_TEAMMATE_FINDINGS, installedFor } from '../../../shared/domain/teammates'
import { Provider } from '../../../shared/domain/types'
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

  /**
   * The seats a panel will run: each reviewer once per provider asked, on that provider's model.
   * Checked before the panel starts, so a skill missing for a provider fails early.
   */
  async describe(
    requests: readonly PanelSeatRequest[],
    models: { primary: OrganizationPreferences; companion?: OrganizationPreferences },
  ): Promise<PanelReviewer[]> {
    const asked = requests.map((request) =>
      typeof request === 'string'
        ? { id: request, providers: [models.primary.provider] }
        : {
            id: request.id,
            providers: [...new Set(request.providers ?? [models.primary.provider])],
          },
    )
    if (new Set(asked.map((entry) => entry.id)).size !== asked.length)
      throw new UserError('Pick each reviewer only once.')
    if (!asked.length || asked.length > MAX_PANEL_REVIEWERS)
      throw new UserError(`Pick between 1 and ${String(MAX_PANEL_REVIEWERS)} reviewers.`)
    const seats = await Promise.all(
      asked.flatMap(({ id, providers }) =>
        providers.map(async (provider) => {
          const reviewer = await this.reviewer(id, provider)
          const model = modelForProvider(provider, models)
          if (providers.length === 1) return { ...reviewer, model }
          return {
            ...reviewer,
            id: `${id}@${provider}`,
            name: `${reviewer.name} (${providerName(provider)})`,
            model,
          }
        }),
      ),
    )
    return seats
  }

  /** A reviewer's instructions as of now; a teammate whose skill was uninstalled fails here. */
  async load(reviewer: PanelReviewer, provider: Provider): Promise<PanelMember> {
    const teammate = reviewerTeammate(reviewer.id)
    if (!teammate)
      return {
        ...reviewer,
        instructions: await this.options.builtIn(seatReviewer(reviewer.id) as BuiltInReviewer),
      }
    const skill = await this.options.teammates.skill(teammate, provider)
    return { ...reviewer, instructions: skill.text, directory: skill.directory }
  }

  /**
   * Each teammate seat's skill folder, on the provider it reviewed with, for the judge to check
   * findings that cite it. A teammate uninstalled since its review is left out.
   */
  async skillFolders(
    reviewers: readonly PanelReviewer[],
    fallback: Provider,
  ): Promise<Map<string, string>> {
    const folders = new Map<string, string>()
    for (const reviewer of reviewers) {
      const teammate = reviewerTeammate(reviewer.id)
      if (!teammate) continue
      const provider = reviewer.model?.provider ?? fallback
      const skill = await this.options.teammates.skill(teammate, provider).catch(() => undefined)
      if (skill) folders.set(reviewer.id, skill.directory)
    }
    return folders
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
        `${teammate.name}'s skill, ${teammate.skill}, is not installed for ${providerName(provider)}. Install it there or ask ${teammate.name} on the other provider.`,
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

function providerName(provider: Provider) {
  return provider === Provider.claude ? 'Claude' : 'Codex'
}
