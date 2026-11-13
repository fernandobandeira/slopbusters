import { triage } from './triage'
import { anchorLabel } from './anchors'
import {
  groundingKindLabels,
  groundingOriginLabels,
  groundingResolutionLabels,
  groundingVerdictLabels,
  leadSource,
  type GroundingCandidate,
  type ResolvedEntry,
} from './grounding'
import type { JudgedFinding, PanelReviewer } from './panel'
import { gateItems, type GateItem, type GateRoute } from './panelGate'
import { panelFindingMarkdown, panelReviewMarkdown } from './panelMarkdown'
import type { PanelResult } from './panelSession'
import { pullName } from './pullUrl'

/**
 * Rules for any agent carrying out the author's chosen fixes, whether a fix thread or a chat the
 * author pastes the review into.
 */
export const fixRules = [
  '- Apply only the plans below. Do not change unrelated code, the PR title or description, or other PRs in the stack.',
  '- A plan is a proposal checked against the code, not a fact. Confirm it in the code first; if it is wrong or incomplete, skip it and say why rather than improvising a different fix.',
  "- Follow the repository's instructions (AGENTS.md, CLAUDE.md and the like) and the conventions each plan names.",
  "- After the changes, run the repository's declared lint, build and the tests relevant to what you changed. Install dependencies first if this worktree needs them.",
]

/** One chosen fix in full: its plan, the author's answer, why, the evidence and the reviewers' words. */
export function fixSection(
  item: GateItem,
  index: number,
  candidates: readonly GroundingCandidate[],
): string {
  const { entry, action } = item
  const sources = candidates.filter((candidate) => entry.sources.includes(candidate.key))
  const title = sources[0]?.finding.title ?? entry.id
  const lines = [`### ${String(index + 1)}. ${title}`, '', `Plan: ${item.plan ?? ''}`]
  if (entry.question && action.answer)
    lines.push('', `The author's answer to "${entry.question}": ${action.answer}`)
  lines.push(
    '',
    `Kind: ${entry.kind ? groundingKindLabels[entry.kind] : 'Not recorded'}. Effort: ${entry.effort ?? 'Not recorded'}.`,
    `Triage: ${triage(entry).reason}`,
    `Why: ${entry.reason}`,
  )
  if (entry.evidence.length) lines.push(`Evidence: ${entry.evidence.join(', ')}`)
  if (entry.origin) lines.push(`Origin: ${groundingOriginLabels[entry.origin]}`)
  lines.push('', 'What the reviewers wrote:')
  for (const { seat, finding } of sources)
    lines.push(
      '',
      `> **${finding.title}** (${seat}, ${anchorLabel(finding.anchor)})`,
      ...finding.body.split('\n').map((line) => `> ${line}`),
    )
  return lines.join('\n')
}

/**
 * The whole grounded review for the clipboard, written as a brief an agent can act on: the
 * reviewed revision, the fixes the author chose with their plans, and what else the panel found
 * as context. Sessions judged before grounding fall back to the judged review.
 */
export function panelBriefMarkdown(result: PanelResult, reviewers: PanelReviewer[]): string {
  const resolved = result.grounding?.resolved
  if (!resolved?.length)
    return [revisionHeader(result), panelReviewMarkdown(result.advice, reviewers)].join('\n\n')
  const candidates = result.grounding?.candidates ?? []
  const items = gateItems(resolved, result.gate, result.pull.number)
  const chosen = items
    .filter((item) => item.action.selected && item.plan && !item.problem)
    .sort((a, b) => triage(a.entry).rank - triage(b.entry).rank)
  const decisions = items
    .filter((item) => triage(item.entry).disposition === 'ask' && !chosen.includes(item))
    .sort((a, b) => triage(a.entry).rank - triage(b.entry).rank)
  const blocked = items.filter((item) => item.action.selected && item.problem)
  const rest = items.filter(
    (item) => !item.action.selected && !decisions.includes(item) && !settledRejection(item.entry),
  )
  return [
    `Panel review of ${pullName(result.pull)}, "${result.pull.title}" (${result.pull.url}). Reviewers raised findings, two models grounded them against the code, and the author chose which to fix.`,
    revisionHeader(result),
    `## Verdict\n\n${result.advice.summary}`,
    chosen.length
      ? `## Rules\n\n${fixRules.join('\n')}\n\n## The fixes the author chose\n\n${chosen.map((item, index) => withRoute(fixSection(item, index, candidates), item.route)).join('\n\n')}`
      : '## The fixes the author chose\n\nNone yet. Treat the findings below as context, and ask before changing code.',
    section(
      'Needs your decision',
      'Do not act on these until the author answers.',
      decisions.map(
        (item) =>
          `${entryBrief(item, candidates)}\n  Question: ${item.entry.question ?? 'Which position should be taken?'}\n  Recommendation: ${item.entry.plan ?? 'No recommendation recorded.'}\n  Cost: ${item.entry.effort ?? 'Not recorded'}.`,
      ),
    ),
    section(
      'Chosen but not ready',
      'Do not act on these until the author resolves what blocks them.',
      blocked.map((item) => `${entryBrief(item, candidates)}\n  Blocked: ${item.problem ?? ''}`),
    ),
    section(
      'Other grounded findings',
      'Context only. The author did not choose these; do not fix them unless asked.',
      rest.map((item) => entryBrief(item, candidates)),
    ),
    section(
      'Rejected by both models',
      'Already checked and set aside. Do not reintroduce them.',
      result.advice.setAside.map((item) => `- **${item.title}**: ${item.reason}`),
    ),
    section('Unresolved disagreements', '', result.advice.disagreements.map(bullet)),
    section('Review limitations', '', result.advice.limitations.map(bullet)),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** One finding with what grounding and the author decided about it, for the clipboard. */
export function panelFindingBrief(result: PanelResult, finding: JudgedFinding): string {
  const entry = result.grounding?.resolved?.find((item) => item.id === finding.id)
  const item = entry && gateItem(result, entry)
  return [
    `From the panel review of ${pullName(result.pull)} at \`${result.pull.headSha}\` (${result.pull.url}).`,
    panelFindingMarkdown(finding),
    item ? groundingMarkdown(item) : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The plan a finding's draft comment starts from: the author's or the grounded one. */
export function panelFindingPlan(result: PanelResult, finding: JudgedFinding): string | undefined {
  const entry = result.grounding?.resolved?.find((item) => item.id === finding.id)
  return entry && gateItem(result, entry).plan
}

function gateItem(result: PanelResult, entry: ResolvedEntry): GateItem {
  const items = gateItems(result.grounding?.resolved ?? [], result.gate, result.pull.number)
  return (
    items.find((item) => item.entry.id === entry.id) ?? {
      entry,
      action: { entry: entry.id, selected: false },
    }
  )
}

function groundingMarkdown({ entry, action, plan, problem }: GateItem): string {
  const verdict = entry.verdict ? groundingVerdictLabels[entry.verdict] : 'No verdict yet'
  const origin = entry.origin ? ` · ${groundingOriginLabels[entry.origin]}` : ''
  const lines = [
    `**Grounding:** ${verdict} · ${groundingResolutionLabels[entry.resolution]}${origin}`,
    `Why: ${entry.reason}`,
    plan ? `Plan: ${plan}` : '',
    entry.question ? `Question for the author: ${entry.question}` : '',
    action.answer ? `The author's answer: ${action.answer}` : '',
    entry.missing ? `Evidence needed: ${entry.missing}` : '',
    entry.evidence.length ? `Evidence: ${entry.evidence.join(', ')}` : '',
    entry.other ? `The other model held: ${otherPosition(entry.other)}` : '',
    action.selected ? `The author chose to fix this.${problem ? ` Blocked: ${problem}` : ''}` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

function otherPosition(other: NonNullable<ResolvedEntry['other']>): string {
  return [
    ...other.entries.map(
      (item) =>
        `${item.verdict ? groundingVerdictLabels[item.verdict] : 'no verdict'}: ${item.reason}`,
    ),
    ...other.objections.map((objection) => `objected: ${objection}`),
  ].join('; ')
}

/** A short line for an entry the agent should know about but not act on. */
function entryBrief(item: GateItem, candidates: readonly GroundingCandidate[]): string {
  const { entry } = item
  const lead = leadSource(entry, candidates)
  const where = lead ? ` (\`${anchorLabel(lead.finding.anchor)}\`)` : ''
  const verdict = entry.verdict ? groundingVerdictLabels[entry.verdict] : 'No verdict yet'
  const details = [
    `Triage: ${triage(entry).reason}`,
    `${verdict}, ${groundingResolutionLabels[entry.resolution].toLowerCase()}: ${entry.reason}`,
    item.plan ? `Plan: ${item.plan}` : '',
    entry.question ? `Question for the author: ${entry.question}` : '',
    entry.missing ? `Evidence needed: ${entry.missing}` : '',
  ].filter(Boolean)
  return `- **${lead?.finding.title ?? entry.id}**${where}\n${details.map((line) => `  ${line}`).join('\n')}`
}

/** Fixes outside this PR's code say where they belong. */
function withRoute(text: string, route: GateRoute | undefined): string {
  if (route?.kind === 'metadata')
    return `${text}\n\nThis fix changes the PR ${route.field}, not the code.`
  if (route?.kind === 'layer')
    return `${text}\n\nThis fix belongs to PR #${String(route.pull)} in the stack.`
  return text
}

function revisionHeader(result: PanelResult): string {
  return `Reviewed head \`${result.pull.headSha}\` (base \`${result.pull.baseSha}\`). Check whether the branch has moved past this commit before editing.`
}

function settledRejection(entry: ResolvedEntry): boolean {
  return (
    triage(entry).disposition === 'skip' &&
    entry.resolution === 'agreed' &&
    ['notTrue', 'overEngineering', 'tasteSkip', 'handledUpstack'].includes(entry.verdict ?? '')
  )
}

function section(title: string, note: string, lines: string[]): string {
  if (!lines.length) return ''
  return [`## ${title}`, note, lines.join('\n')].filter(Boolean).join('\n\n')
}

function bullet(text: string): string {
  return `- ${text}`
}
