import type { ResolvedEntry } from './grounding'

export type Disposition = 'fix' | 'skip' | 'ask'
export const dispositionLabels: Record<Disposition, string> = {
  fix: 'Fix',
  skip: 'Skip',
  ask: 'Your call',
}

interface Triage {
  disposition: Disposition
  rank: number
  reason: string
}

/**
 * What the author would do with a grounded finding, apart from whether the code supports it: the
 * first rule that applies wins. The author takes the panel's recommendation on a question unless
 * it goes against the ticket, so only those and the models' disagreements come back to them.
 */
export function triage(entry: ResolvedEntry): Triage {
  return unsettled(entry) ?? rejected(entry) ?? question(entry) ?? worth(entry)
}

/** Without a verdict nothing can be decided; without agreement the author picks a side. */
function unsettled(entry: ResolvedEntry): Triage | undefined {
  if (!entry.verdict) return skip('Needs evidence before it can be decided.')
  if (entry.resolution !== 'agreed')
    return ask(entry, 'Needs the author to settle what the models could not agree on.')
  return undefined
}

const rejections: Partial<Record<NonNullable<ResolvedEntry['verdict']>, string>> = {
  notTrue: 'The code contradicts this finding.',
  overEngineering: 'A simpler change is enough.',
  handledUpstack: 'Another stack layer already settles this.',
}

function rejected(entry: ResolvedEntry): Triage | undefined {
  const reason = entry.verdict && rejections[entry.verdict]
  return reason ? skip(reason) : undefined
}

/**
 * An author's call takes the panel's recommendation unless it goes against the ticket. Calls
 * grounded before recommendations were asked for, which have no kind, still go to the author.
 */
function question(entry: ResolvedEntry): Triage | undefined {
  if (entry.verdict !== 'authorsCall') return undefined
  if (entry.ticketConflict) return ask(entry, 'The recommendation goes against the ticket.')
  if (!entry.kind) return ask(entry, 'Needs a decision only the author can make.')
  if (!entry.plan) return skip('The recommendation is to leave it as it is.')
  return undefined
}

const fixReasons: Record<NonNullable<ResolvedEntry['kind']>, string> = {
  simplification: 'Removes code nothing needs.',
  defect: 'Corrects a confirmed defect.',
  rule: 'Follows a written repository rule or established convention.',
  wording: 'Clarifies naming or wording.',
  product: 'Corrects confirmed product behavior.',
  test: 'Changes tests only.',
  edgeCase: 'Covers a case that needs several things to go wrong.',
}

/** What is left is worth fixing, unless it predates the PR, costs more than it saves, or is taste. */
function worth(entry: ResolvedEntry): Triage {
  const { verdict, kind } = entry
  if (entry.origin === 'preexisting')
    return skip('Already there before this change; leave it for a follow-up.')
  if (entry.plan && entry.effort === 'small' && new Set(entry.raisedBy).size >= 2)
    return fix(entry, 'Costs little and several reviewers raised it.')
  if (verdict === 'tasteSkip') return skip('A preference with no demonstrated cost.')
  if (kind === 'edgeCase') return skip('Needs several things to go wrong together.')
  if (verdict === 'authorsCall')
    return fix(entry, "Takes the panel's recommendation; nothing in the ticket says otherwise.")
  return fix(entry, kind ? fixReasons[kind] : 'Both models agree this is worth fixing.')
}

function fix(entry: ResolvedEntry, reason: string): Triage {
  return { disposition: 'fix', rank: fixRank(entry.kind), reason }
}

function ask(entry: ResolvedEntry, reason: string): Triage {
  return { disposition: 'ask', rank: entry.kind === 'simplification' ? 0 : 1, reason }
}

function skip(reason: string): Triage {
  return { disposition: 'skip', rank: 0, reason }
}

function fixRank(kind: ResolvedEntry['kind']): number {
  if (kind === 'simplification') return 0
  if (kind === 'wording' || kind === 'product') return 2
  if (kind === 'test') return 3
  return 1
}
