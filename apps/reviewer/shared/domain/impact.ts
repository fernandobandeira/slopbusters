/**
 * What is at stake when the finding holds, apart from what it asks for: kind says a change is a
 * defect, impact says whether that defect moves money or only mis-renders a label. The first five
 * are serious: each needs a decision before anything else, and its consequence written out.
 */
export const groundingImpacts = [
  'money',
  'data',
  'contract',
  'operations',
  'security',
  'behavior',
  'maintainability',
  'preference',
] as const
export type GroundingImpact = (typeof groundingImpacts)[number]
export const groundingImpactLabels: Record<GroundingImpact, string> = {
  money: 'Money or ledger',
  data: 'Data integrity',
  contract: 'Public contract',
  operations: 'Operations',
  security: 'Security',
  behavior: 'User-visible behavior',
  maintainability: 'Maintainability',
  preference: 'Preference',
}
/** What a grounded or stack entry says about its stakes, whatever else it holds. */
interface Claimed {
  impact?: GroundingImpact
  consequence?: string
  verdict?: string
  /** Whether the two models agree; absent on one model's own list. */
  resolution?: 'agreed' | 'disputed' | 'unverified'
}

const seriousImpacts: ReadonlySet<GroundingImpact> = new Set([
  'money',
  'data',
  'contract',
  'operations',
  'security',
])

/**
 * An entry whose consequence is serious and that the models have not agreed to set aside as
 * untrue, settled elsewhere or a matter of taste. A rejection the models disagree on settles
 * nothing.
 */
export function isSerious<T extends Claimed>(entry: T): entry is T & { impact: GroundingImpact } {
  const unsettled = entry.resolution === 'disputed'
  return (
    !!entry.impact &&
    seriousImpacts.has(entry.impact) &&
    (unsettled || !['notTrue', 'handledUpstack', 'tasteSkip'].includes(entry.verdict ?? ''))
  )
}

/** A serious consequence one of the models claims, and whether the last list contests it. */
export interface SeriousClaim {
  impact: GroundingImpact
  consequence?: string
  /** Only the other model claims it; the entry holds what the last list said instead. */
  contested: boolean
}

/**
 * The serious consequence of an entry, or, while the models disagree, the one the other model
 * held: a money claim downgraded or rejected on the last turn is still the author's to settle.
 */
export function seriousClaim(
  entry: Claimed & { other?: { entries: Claimed[] } },
): SeriousClaim | undefined {
  const held = isSerious(entry)
    ? entry
    : entry.resolution === 'disputed'
      ? entry.other?.entries.find(isSerious)
      : undefined
  if (!held) return undefined
  return {
    impact: held.impact,
    ...(held.consequence ? { consequence: held.consequence } : {}),
    contested: held !== entry,
  }
}

/** What settles a serious entry, for every brief that lists them. */
export const settleSerious =
  'Settle each of these before any other work: fix it and check the fix, refute it with evidence, or have the author accept the risk with a reason. An investigation assigned to an owner, with the check that would close it, keeps it open, not settled. Two models reading the code do not prove a race or an ordering problem; a test that forces the order does.'
