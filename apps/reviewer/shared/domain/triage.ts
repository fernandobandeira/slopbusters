import type { ResolvedEntry } from './grounding'
import { seatReviewer } from './panel'

/** `prepare`: the reviewer will likely ask, the models would not; have the reply ready. */
export type Disposition = 'fix' | 'skip' | 'ask' | 'prepare'
export const dispositionLabels: Record<Disposition, string> = {
  fix: 'Fix',
  skip: 'Skip',
  ask: 'Your call',
  prepare: 'Reply ready',
}

interface Decision {
  disposition: Disposition
  rank: number
  reason: string
}

/**
 * What the author would do with a grounded finding, apart from whether the code supports it: the
 * first rule that applies wins. The author takes the panel's recommendation on a question unless
 * it goes against the ticket, so only those and the models' disagreements come back to them.
 */
export function triage(entry: ResolvedEntry): Decision & { followUp: boolean } {
  const decision =
    unsettled(entry) ??
    rejected(entry) ??
    marked(entry) ??
    prediction(entry) ??
    question(entry) ??
    worth(entry)
  const real = entry.verdict === 'legit' || (entry.verdict === 'authorsCall' && !!entry.plan)
  const followUp =
    decision.disposition === 'skip' &&
    entry.resolution === 'agreed' &&
    real &&
    (entry.origin === 'preexisting' || entry.kind === 'edgeCase')
  return { ...decision, followUp }
}

/** Without a verdict nothing can be decided; without agreement the author picks a side. */
function unsettled(entry: ResolvedEntry): Decision | undefined {
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

function rejected(entry: ResolvedEntry): Decision | undefined {
  const reason = entry.verdict && rejections[entry.verdict]
  return reason ? skip(reason) : undefined
}

/**
 * A plan that would undo what an earlier round asked for, or that another finding opposes, is
 * the author's to decide, first: making it by default is how a review loop flips code back and
 * forth. A real defect in an earlier fix is fixed without undoing the request, so it is not marked.
 */
function marked(entry: ResolvedEntry): Decision | undefined {
  if (entry.reverses)
    return {
      disposition: 'ask',
      rank: 0,
      reason: 'Would undo a change an earlier round asked for.',
    }
  if (entry.opposes)
    return { disposition: 'ask', rank: 0, reason: 'Another finding asks for the opposite change.' }
  return undefined
}

/**
 * The reviewer will likely ask for it though the models would not. That prepares a conversation;
 * it is no reason to edit code, however small the change, so the reply is kept ready and the
 * author can still choose the change. The biggest first, because being caught by it costs most.
 */
function prediction(entry: ResolvedEntry): Decision | undefined {
  if (entry.verdict !== 'predicted') return undefined
  return {
    disposition: 'prepare',
    rank: entry.effort === 'large' ? 0 : entry.effort === 'medium' ? 1 : 2,
    reason:
      'The reviewer will likely ask for this, though the models would not; have the reply ready.',
  }
}

/**
 * An author's call takes the panel's recommendation unless it goes against the ticket. Calls
 * grounded before recommendations were asked for, which have no kind, still go to the author.
 */
function question(entry: ResolvedEntry): Decision | undefined {
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
function worth(entry: ResolvedEntry): Decision {
  const { verdict, kind } = entry
  if (entry.origin === 'preexisting')
    return skip('Already there before this change; leave it for a follow-up.')
  if (entry.plan && entry.effort === 'small' && reviewers(entry) >= 2)
    return fix(entry, 'Costs little and several reviewers raised it.')
  if (verdict === 'tasteSkip') return skip('A preference with no demonstrated cost.')
  if (kind === 'edgeCase') return skip('Needs several things to go wrong together.')
  if (verdict === 'authorsCall')
    return fix(entry, "Takes the panel's recommendation; nothing in the ticket says otherwise.")
  return fix(entry, kind ? fixReasons[kind] : 'Both models agree this is worth fixing.')
}

/** One reviewer on both providers, or in two versions of its seat, is still one reviewer. */
function reviewers(entry: ResolvedEntry): number {
  return new Set(entry.raisedBy.map(seatReviewer)).size
}

function fix(entry: ResolvedEntry, reason: string): Decision {
  return { disposition: 'fix', rank: fixRank(entry.kind), reason }
}

function ask(entry: ResolvedEntry, reason: string): Decision {
  return { disposition: 'ask', rank: entry.kind === 'simplification' ? 1 : 2, reason }
}

function skip(reason: string): Decision {
  return { disposition: 'skip', rank: 0, reason }
}

function fixRank(kind: ResolvedEntry['kind']): number {
  if (kind === 'simplification') return 0
  if (kind === 'wording' || kind === 'product') return 2
  if (kind === 'test') return 3
  return 1
}
