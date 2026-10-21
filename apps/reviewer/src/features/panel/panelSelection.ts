import type { ReviewerId } from '../../../shared/domain/panel'
import { installedFor, skillAvailability, type Teammate } from '../../../shared/domain/teammates'
import { Provider } from '../../../shared/domain/types'
import {
  builtInReviewerIds,
  builtInReviewers,
  teammateReviewerId,
} from '../../../shared/domain/panel'

const SELECTION_KEY = 'slopbusters:panel-reviewers'
const providers = [Provider.codex, Provider.claude] as const

/** A reviewer the user picked, and the providers to run it on; none means its default ones. */
export interface PanelChoice {
  id: ReviewerId
  providers?: Provider[]
}

/** Someone who can sit on the panel, and which providers can run them. */
export interface Candidate {
  id: ReviewerId
  name: string
  description?: string
  installed: Record<Provider, boolean>
  /** Why the reviewer cannot run at all, such as a skill that is no longer installed. */
  unavailable?: string
}

const DEFAULT_SELECTION: PanelChoice[] = [{ id: 'unclebob' }, { id: 'terminator' }]

/** The reviewers the user last asked; Uncle Bob and the Terminator until they choose. */
export function savedPanelSelection(): PanelChoice[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null')
    if (!Array.isArray(saved) || !saved.length) return DEFAULT_SELECTION
    // Earlier versions saved bare ids, which ran on the primary model, and called the Terminator rules.
    return saved.map((entry: unknown) => {
      const choice = (typeof entry === 'string' ? { id: entry } : entry) as { id: string }
      return { ...choice, id: choice.id === 'rules' ? 'terminator' : choice.id } as PanelChoice
    })
  } catch {
    return DEFAULT_SELECTION
  }
}

export function savePanelSelection(selection: PanelChoice[]) {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(selection))
  } catch {
    /* The picker still works without browser storage. */
  }
}

/** Uncle Bob and the Terminator first, then every teammate with where its skill is installed. */
export function panelCandidates(teammates: readonly Teammate[]): Candidate[] {
  const everywhere = { [Provider.claude]: true, [Provider.codex]: true }
  return [
    ...builtInReviewerIds.map((id) => ({
      id,
      name: builtInReviewers[id].name,
      description: builtInReviewers[id].description,
      installed: everywhere,
    })),
    ...teammates.map((teammate) => ({
      id: teammateReviewerId(teammate.id),
      name: teammate.name,
      description: teammate.title ?? teammate.skill,
      installed: {
        [Provider.claude]: installedFor(teammate.locations, Provider.claude),
        [Provider.codex]: installedFor(teammate.locations, Provider.codex),
      },
      ...(skillAvailability(teammate.locations) === 'missing'
        ? { unavailable: `${teammate.skill} is no longer installed.` }
        : {}),
    })),
  ]
}

/**
 * The picked reviewers that can run, each with the providers it will run on: the ones picked,
 * else its default providers.
 */
export function resolveChoices(
  selection: readonly PanelChoice[],
  candidates: readonly Candidate[],
  primary: Provider,
): Required<PanelChoice>[] {
  return selection.flatMap((choice) => {
    const candidate = candidates.find((entry) => entry.id === choice.id)
    if (!candidate || candidate.unavailable) return []
    const asked = (choice.providers ?? []).filter((provider) => candidate.installed[provider])
    const chosen = asked.length ? asked : defaultProviders(candidate, primary)
    return chosen.length ? [{ id: choice.id, providers: chosen }] : []
  })
}

/** Turn a reviewer on with its default providers, or off. */
export function toggleReviewer(
  choices: Required<PanelChoice>[],
  candidate: Candidate,
  primary: Provider,
): Required<PanelChoice>[] {
  if (choices.some((choice) => choice.id === candidate.id))
    return choices.filter((choice) => choice.id !== candidate.id)
  const chosen = defaultProviders(candidate, primary)
  return chosen.length ? [...choices, { id: candidate.id, providers: chosen }] : choices
}

/**
 * A teammate sits once on every provider its skill is installed for, so both models predict its
 * comments; a built-in reviewer runs on the primary model's provider, else wherever it can.
 */
function defaultProviders(candidate: Candidate, primary: Provider): Provider[] {
  const installed = providers.filter((provider) => candidate.installed[provider])
  if (candidate.id.startsWith('teammate:')) return installed
  return installed.includes(primary) ? [primary] : installed.slice(0, 1)
}

/** Add or drop one provider for a reviewer; dropping the last one takes the reviewer off. */
export function toggleProvider(
  choices: Required<PanelChoice>[],
  id: ReviewerId,
  provider: Provider,
): Required<PanelChoice>[] {
  const current = choices.find((choice) => choice.id === id)
  if (!current) return [...choices, { id, providers: [provider] }]
  const next = current.providers.includes(provider)
    ? current.providers.filter((item) => item !== provider)
    : providers.filter((item) => item === provider || current.providers.includes(item))
  return next.length
    ? choices.map((choice) => (choice.id === id ? { id, providers: next } : choice))
    : choices.filter((choice) => choice.id !== id)
}
