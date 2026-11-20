import { triage, type Disposition } from './triage'
import { anchorLabel } from './anchors'
import type { EarlierRequest } from './consistency'
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
  else if (entry.question)
    lines.push('', `On "${entry.question}", this takes the panel's recommendation.`)
  const facts = [
    entry.kind ? `Kind: ${groundingKindLabels[entry.kind]}.` : '',
    entry.effort ? `Effort: ${entry.effort}.` : '',
  ].filter(Boolean)
  lines.push(
    '',
    ...(facts.length ? [facts.join(' ')] : []),
    `Triage: ${triage(entry).reason}`,
    entry.verdict === 'predicted'
      ? `The models would not ask for this; the reviewer likely will. Their reasoning, should the author keep the code: ${entry.reason}`
      : `Why: ${entry.reason}`,
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
  const chosen = chosenFixes(items)
  const open = (disposition: Disposition) =>
    items
      .filter((item) => triage(item.entry).disposition === disposition && !chosen.includes(item))
      .sort((a, b) => triage(a.entry).rank - triage(b.entry).rank)
  const decisions = open('ask')
  const predicted = open('prepare')
  const blocked = items.filter(
    (item) => item.action.selected && item.problem && !triage(item.entry).followUp,
  )
  const rest = items.filter(
    (item) =>
      !item.action.selected &&
      !decisions.includes(item) &&
      !predicted.includes(item) &&
      !settledRejection(item.entry) &&
      !triage(item.entry).followUp,
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
      decisionLines(decisions, result, candidates),
    ),
    section(
      'Predicted reviewer comments',
      'The reviewer will likely ask for these, though both models would leave the code as it is. Keep the reply ready. Do not make the change unless the author chooses it.',
      predicted.map(
        (item) =>
          `${entryBrief(item, candidates)}\n  Change that answers the reviewer: ${item.entry.plan ?? 'None recorded.'}${item.entry.effort ? `\n  Cost: ${item.entry.effort}.` : ''}\n  Reply if the code stays: ${item.entry.reason}`,
      ),
    ),
    section(
      'Chosen but not ready',
      'Do not act on these until the author resolves what blocks them.',
      blocked.map((item) => `${entryBrief(item, candidates)}\n  Blocked: ${item.problem ?? ''}`),
    ),
    section(
      'Follow-ups',
      'Deferred from this PR. Do not fix these here.',
      items
        .filter((item) => triage(item.entry).followUp)
        .map((item) => {
          const ticket = result.followUps?.find((filed) => filed.entry === item.entry.id)
          const title = leadSource(item.entry, candidates)?.finding.title ?? item.entry.id
          return `- **${title}**: ${triage(item.entry).reason}${ticket ? ` Ticket: [${ticket.identifier}](${ticket.url})` : ''}`
        }),
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

/** Each decision for the author, with findings that ask for opposite changes as one item. */
function decisionLines(
  decisions: readonly GateItem[],
  result: PanelResult,
  candidates: readonly GroundingCandidate[],
): string[] {
  const done = new Set<string>()
  const earlier = result.grounding?.earlier?.requests ?? []
  return decisions.flatMap((item) => {
    if (done.has(item.entry.id)) return []
    done.add(item.entry.id)
    const { opposes } = item.entry
    if (!opposes) return [decisionLine(item, candidates, earlier)]
    const sides = [item.entry, ...opposes.entries.flatMap((id) => resolvedOf(result, id) ?? [])]
    for (const side of sides) done.add(side.id)
    return [
      `- **Opposed changes**: ${opposes.reason}\n  Question: These ask for opposite changes. Which one, if either?\n${sides.map((side) => `  - ${sideLine(side, candidates, earlier)}`).join('\n')}`,
    ]
  })
}

function decisionLine(
  item: GateItem,
  candidates: readonly GroundingCandidate[],
  earlier: readonly EarlierRequest[],
): string {
  const { entry } = item
  const reversal = entry.reverses && reversalLines(entry.reverses, earlier)
  const lines = [
    entryBrief(item, candidates),
    ...(reversal
      ? [
          reversal,
          '  Question: Undo the earlier change, or keep it?',
          ...(entry.verdict === 'predicted' ? [`  Reply if the code stays: ${entry.reason}`] : []),
        ]
      : [`  Question: ${entry.question ?? 'Which position should be taken?'}`]),
    entry.ticketConflict ? `  Goes against the ticket: ${entry.ticketConflict}` : '',
    `  Recommendation: ${entry.plan ?? 'No recommendation recorded.'}`,
    entry.effort ? `  Cost: ${entry.effort}.` : '',
  ]
  return lines.filter(Boolean).join('\n')
}

/** The earlier request an entry's plan would undo, beside why the check says so. */
function reversalLines(
  reverses: NonNullable<ResolvedEntry['reverses']>,
  earlier: readonly EarlierRequest[],
): string {
  const request = earlier.find((item) => item.key === reverses.earlier)
  const asked = request
    ? `${request.entry} from the round of ${request.round}, "${request.title}": ${request.plan} Its reason: ${request.reason}`
    : reverses.earlier
  return `  Would undo what an earlier round asked for: ${asked}\n  The check found: ${reverses.reason}`
}

function sideLine(
  entry: ResolvedEntry,
  candidates: readonly GroundingCandidate[],
  earlier: readonly EarlierRequest[],
): string {
  const title = leadSource(entry, candidates)?.finding.title ?? entry.id
  const reversal = entry.reverses ? `\n${reversalLines(entry.reverses, earlier)}` : ''
  return `**${title}** (${entry.id}, raised by ${entry.raisedBy.join(', ')}): ${entry.plan ?? 'No plan recorded.'}${reversal}`
}

function resolvedOf(result: PanelResult, id: string): ResolvedEntry | undefined {
  return result.grounding?.resolved?.find((entry) => entry.id === id)
}

/** The fixes ready to carry out, as the author chose them or by default, in triage order. */
export function chosenFixes(items: readonly GateItem[]): GateItem[] {
  return items
    .filter(
      (item) => item.action.selected && item.plan && !item.problem && !triage(item.entry).followUp,
    )
    .sort((a, b) => triage(a.entry).rank - triage(b.entry).rank)
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
