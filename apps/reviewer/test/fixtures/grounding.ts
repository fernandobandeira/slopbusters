import type { EarlierRequests } from '../../shared/domain/consistency'
import type { GroundingCandidate, ResolvedEntry } from '../../shared/domain/grounding'
import type { PanelResult } from '../../shared/domain/panelSession'
import { Provider } from '../../shared/domain/types'
import { fixtureJudgeAdvice, fixturePanelFinding } from './panel'
import { fixturePull } from './pull'

/** A seat's finding as grounding selected it, titled `title`. */
export function groundedSource(
  key: string,
  title: string,
  seat = 'unclebob',
  pull = fixturePull().number,
): GroundingCandidate {
  return {
    key,
    pull,
    seat,
    rank: Number(key.slice(1)) - 1,
    finding: fixturePanelFinding({ id: `finding-${key}`, title, body: `${title}.` }),
    state: 'selected',
  }
}

/** An agreed, legit entry worth fixing, grounded from `source`. */
export function groundedEntry(
  id: string,
  source: string,
  changes: Partial<ResolvedEntry> = {},
): ResolvedEntry {
  return {
    id,
    sources: [source],
    verdict: 'legit',
    reason: `Reason for ${id}.`,
    evidence: ['src/audit.ts:4'],
    plan: `Plan for ${id}.`,
    origin: 'change',
    kind: 'defect',
    effort: 'medium',
    destination: { kind: 'code', pull: fixturePull().number },
    resolution: 'agreed',
    raisedBy: ['unclebob'],
    ...changes,
  }
}

/** A finished panel result on PR `number` whose grounding resolved `resolved`. */
export function groundedResult(
  resolved: ResolvedEntry[],
  {
    candidates,
    earlier,
    number = fixturePull().number,
  }: { candidates: GroundingCandidate[]; earlier?: EarlierRequests; number?: number },
): PanelResult {
  const pull = {
    ...fixturePull(),
    number,
    url: `https://github.com/review-room/example/pull/${String(number)}`,
  }
  return {
    pull,
    fingerprint: 'fingerprint',
    advice: fixtureJudgeAdvice(),
    reviews: [],
    grounding: {
      budget: 40,
      candidates,
      roles: { primary: { provider: Provider.claude, model: 'claude-fable-5-2' } },
      ...(earlier ? { earlier } : {}),
      turns: [],
      entries: resolved,
      positions: {},
      outcome: 'agreed',
      resolved,
    },
  }
}
