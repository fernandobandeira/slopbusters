import { answerLabel, dispositionSummary } from './stackReviewRecords'
import { groundingKindLabels } from './grounding'
import { groundingImpactLabels, settleSerious } from './impact'
import type { BriefAnswer, BriefFix, BriefSerious, StackBrief } from './stackBrief'
import { short, type BriefLayer } from './stackBriefLayers'

/** Rules for an agent working the stack from the brief. */
const stackRules = [
  '- Settle every serious consequence before other work, and record how each was settled.',
  '- Work bottom to top. Each fix names the layer whose code must change; make it on that layer and let the layers above take it in.',
  '- Apply only the plans below. A plan is a proposal checked against the code, not a fact: confirm it first, and skip it with a reason when it is wrong.',
  '- Do not act on "Needs your decision" until the author answers, and leave follow-ups for later.',
  "- Before editing a layer, check it is still at the head below; a stale entry may no longer hold. Follow the repository's instructions and run its lint, build and relevant tests.",
]

/** The stack brief as Markdown, for the clipboard and for coding agents. */
export function stackBriefMarkdown(brief: StackBrief, repository: string): string {
  const [bottom, top] = [brief.layers[0], brief.layers.at(-1)]
  const fixes = brief.fixes
    .map(({ layer, items }) => ({ layer, items: items.filter(({ applied }) => !applied) }))
    .filter(({ items }) => items.length)
  return [
    `# Stack review of ${repository}, PR #${String(bottom?.number ?? 0)} to PR #${String(top?.number ?? 0)}`,
    `The panel reviewed every layer, then two models read all layers' grounded findings together: what repeats, what one change makes unnecessary elsewhere, which layer owns each change, and what only the whole stack shows.\n\nLayers, bottom to top:\n${brief.layers.map(layerLine).join('\n')}`,
    brief.summary ? `## Summary\n\n${brief.summary}` : '',
    `## Rules\n\n${stackRules.join('\n')}`,
    brief.serious.length
      ? `## Serious consequences\n\n${settleSerious}\n\n${brief.serious.map(seriousLines).join('\n')}`
      : '',
    ...recordSections(brief),
    section(
      'Needs your decision',
      brief.decisions.map((item) =>
        [
          `- **${item.title}** (${item.id}, PR #${String(item.layer)})${mark(item.contested)}`,
          `  Question: ${item.question}`,
          ...item.options.map(
            (option) =>
              `  - \`${option.id}\`: ${option.label}${option.recommended ? ' (default)' : ''}${option.detail ? ` — ${option.detail}` : ''}${option.reply ? ` — Reply if chosen: ${option.reply}` : ''}`,
          ),
          ...(item.cost ? [`  Cost: ${item.cost}.`] : []),
          `  Why it is yours: ${item.why}`,
        ].join('\n'),
      ),
    ),
    fixes.length
      ? `## Fixes, bottom to top\n\n${fixes.map(({ layer, items }) => `### PR #${String(layer.number)}: ${layer.title}\n\n${items.map(fixLines).join('\n\n')}`).join('\n\n')}`
      : '## Fixes, bottom to top\n\nNone.',
    section(
      'Made unnecessary',
      brief.chains.map(
        (chain) =>
          `- ${chain.cause.id} (${chain.cause.title}) makes these unnecessary: ${chain.unnecessary.map((item) => `${item.id} (${item.title})`).join(', ')}. ${chain.reason}`,
      ),
    ),
    brief.followUps.length
      ? `## Follow-ups\n\n<details>\n<summary>${String(brief.followUps.length)} left for later; not for this stack</summary>\n\n${brief.followUps.map((item) => `- **${item.title}** (${item.id}): ${item.triage}`).join('\n')}\n\n</details>`
      : '',
    section(
      'Stale entries',
      brief.stale.map((item) => `- ${item.reason} Entries: ${item.entries.join(', ') || 'none'}.`),
    ),
    section(
      'Limitations',
      brief.limitations.map((item) => `- ${item}`),
    ),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function recordSections({ review }: StackBrief): string[] {
  if (!review) return []
  return [
    section("The author's decisions", review.answered.map(answerLines)),
    section(
      'Manual work for the author',
      review.answered
        .filter(({ manual, recheck }) => manual && !recheck)
        .map(
          ({ decision, option }) =>
            `- ${decision.title} (${decision.id}): ${option?.change?.plan || option?.label || ''}`,
        ),
    ),
    section(
      'Decision history',
      review.history.map(
        (record) =>
          `- ${record.snapshot.title} (${record.itemId}, ${record.updatedAt.slice(0, 10)}): ${answerLabel(record) ?? ''}${record.answer?.note ? ` · Private note: ${record.answer.note}` : ''}`,
      ),
    ),
  ]
}

function layerLine(layer: BriefLayer, index: number): string {
  const state = !layer.reviewedHead
    ? 'not reviewed'
    : layer.current
      ? `reviewed at \`${short(layer.reviewedHead)}\`, still current`
      : `reviewed at \`${short(layer.reviewedHead)}\`, now at \`${short(layer.currentHead)}\``
  return `${String(index + 1)}. PR #${String(layer.number)} "${layer.title}" (${layer.url}): ${state}`
}

function fixLines(fix: BriefFix, index: number): string {
  const lines = [
    `${String(index + 1)}. **${fix.title}** (${fix.id})${fix.derivedFrom ? ` · derived from ${fix.derivedFrom.join(', ')}` : ''}`,
    `   Plan: ${fix.plan ?? 'None recorded.'}`,
    `   ${[fix.kind ? `Kind: ${groundingKindLabels[fix.kind]}.` : '', fix.effort ? `Effort: ${fix.effort}.` : '', `Triage: ${fix.triage}`].filter(Boolean).join(' ')}`,
  ]
  if (fix.decision) {
    lines.push(
      `   Author decision: ${fix.decision.decisionId} (revision ${fix.decision.revision}).`,
    )
    if (fix.decision.note) lines.push(`   Private note: ${fix.decision.note}`)
  }
  if (fix.field) lines.push(`   This changes the PR ${fix.field}, not the code.`)
  if (fix.alsoRaised.length) lines.push(`   Also raised as: ${fix.alsoRaised.join(', ')}.`)
  if (fix.movedFrom)
    lines.push(`   Moved here from PR #${String(fix.movedFrom.layer)}: ${fix.movedFrom.reason}`)
  return lines.join('\n')
}

function seriousLines(item: BriefSerious): string {
  return [
    `- **${item.title}** (${item.id}, PR #${String(item.layer)}) · ${groundingImpactLabels[item.impact]}`,
    `  Consequence: ${item.consequence}`,
    ...(item.contested
      ? ['  Contested: one model claims this; the other rejected or lowered it.']
      : []),
    `  Where it stands: ${item.standing}`,
    ...(item.disposition
      ? [`  Disposition: ${dispositionSummary(item.disposition)}`]
      : ['  Disposition: outstanding.']),
  ].join('\n')
}

function answerLines({ decision, record, recheck, revision }: BriefAnswer): string {
  const { answer } = record
  return [
    `- **${decision.title}** (${decision.id}, PR #${decision.layer}): ${answerLabel(record) ?? ''}`,
    ...(revision === 0 ? ['  Carried over from an earlier stack review.'] : []),
    ...(recheck ? ['  Recheck against the current layer revisions before acting.'] : []),
    ...(answer.note ? [`  Private note: ${answer.note}`] : []),
    ...(answer.state === 'chosen' && answer.reply ? [`  Reply ready: ${answer.reply}`] : []),
  ].join('\n')
}

function mark(contested: boolean): string {
  return contested ? ' (the second model did not approve this)' : ''
}

function section(title: string, lines: string[]): string {
  return lines.length ? `## ${title}\n\n${lines.join('\n')}` : ''
}
