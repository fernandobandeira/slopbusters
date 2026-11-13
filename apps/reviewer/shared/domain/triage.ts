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

/** Fixed author triage, separate from the models' evidence and classification. */
export function triage(entry: ResolvedEntry): Triage {
  const { verdict, kind } = entry
  if (!verdict)
    return { disposition: 'skip', rank: 0, reason: 'Needs evidence before it can be decided.' }
  if (entry.resolution !== 'agreed')
    return {
      disposition: 'ask',
      rank: decisionRank(kind),
      reason: 'Needs the author to settle what the models could not agree on.',
    }
  if (verdict === 'notTrue')
    return { disposition: 'skip', rank: 0, reason: 'The code contradicts this finding.' }
  if (verdict === 'overEngineering')
    return { disposition: 'skip', rank: 0, reason: 'A simpler change is enough.' }
  if (verdict === 'handledUpstack')
    return { disposition: 'skip', rank: 0, reason: 'Another stack layer already settles this.' }
  if (verdict === 'authorsCall')
    return {
      disposition: 'ask',
      rank: decisionRank(kind),
      reason: 'Needs a decision only the author can make.',
    }
  if (entry.origin === 'preexisting')
    return {
      disposition: 'skip',
      rank: 0,
      reason: 'Already there before this change; leave it for a follow-up.',
    }
  if (entry.plan && entry.effort === 'small' && new Set(entry.raisedBy).size >= 2)
    return {
      disposition: 'fix',
      rank: fixRank(kind),
      reason: 'Costs little and several reviewers raised it.',
    }
  if (verdict === 'tasteSkip')
    return { disposition: 'skip', rank: 0, reason: 'A preference with no demonstrated cost.' }
  if (kind === 'edgeCase')
    return { disposition: 'skip', rank: 0, reason: 'Needs several things to go wrong together.' }
  const reasons = {
    simplification: 'Removes code nothing needs.',
    defect: 'Corrects a confirmed defect.',
    rule: 'Follows a written repository rule or established convention.',
    wording: 'Clarifies naming or wording.',
    product: 'Corrects confirmed product behavior.',
    test: 'Changes tests only.',
  }
  return {
    disposition: 'fix',
    rank: fixRank(kind),
    reason: kind ? reasons[kind] : 'Both models agree this is worth fixing.',
  }
}

function fixRank(kind: ResolvedEntry['kind']): number {
  if (kind === 'simplification') return 0
  if (kind === 'wording' || kind === 'product') return 2
  if (kind === 'test') return 3
  return 1
}

function decisionRank(kind: ResolvedEntry['kind']): number {
  return kind === 'simplification' ? 0 : 1
}
