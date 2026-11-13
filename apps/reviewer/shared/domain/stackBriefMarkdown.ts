import { groundingKindLabels } from './grounding'
import { short, type BriefFix, type BriefLayer, type StackBrief } from './stackBrief'

/** Rules for an agent working the stack from the brief. */
const stackRules = [
  '- Work bottom to top. Each fix names the layer whose code must change; make it on that layer and let the layers above take it in.',
  '- Apply only the plans below. A plan is a proposal checked against the code, not a fact: confirm it first, and skip it with a reason when it is wrong.',
  '- Do not act on "Needs your decision" until the author answers, and leave follow-ups for later.',
  "- Before editing a layer, check it is still at the head below; a stale entry may no longer hold. Follow the repository's instructions and run its lint, build and relevant tests.",
]

/** The stack brief as Markdown, for the clipboard and for coding agents. */
export function stackBriefMarkdown(brief: StackBrief, repository: string): string {
  const [bottom, top] = [brief.layers[0], brief.layers.at(-1)]
  return [
    `# Stack review of ${repository}, PR #${String(bottom?.number ?? 0)} to PR #${String(top?.number ?? 0)}`,
    `The panel reviewed every layer, then two models read all layers' grounded findings together: what repeats, what one change makes unnecessary elsewhere, which layer owns each change, and what only the whole stack shows.\n\nLayers, bottom to top:\n${brief.layers.map(layerLine).join('\n')}`,
    brief.summary ? `## Summary\n\n${brief.summary}` : '',
    `## Rules\n\n${stackRules.join('\n')}`,
    section(
      'Needs your decision',
      brief.decisions.map((item) =>
        [
          `- **${item.title}** (${item.id}, PR #${String(item.layer)})${mark(item.contested)}`,
          `  Question: ${item.question}`,
          `  Recommendation: ${item.recommendation ?? 'Leave it as it is.'}`,
          `  Cost: ${item.cost ?? 'Not recorded'}.`,
          `  Why it is yours: ${item.why}`,
        ].join('\n'),
      ),
    ),
    brief.fixes.length
      ? `## Fixes, bottom to top\n\n${brief.fixes.map(({ layer, items }) => `### PR #${String(layer.number)}: ${layer.title}\n\n${items.map(fixLines).join('\n\n')}`).join('\n\n')}`
      : '## Fixes, bottom to top\n\nNone.',
    section(
      'Made unnecessary',
      brief.chains.map(
        (chain) =>
          `- ${chain.cause.id} (${chain.cause.title}) makes these unnecessary: ${chain.unnecessary.map((item) => `${item.id} (${item.title})`).join(', ')}. ${chain.reason}${mark(chain.contested)}`,
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
    `${String(index + 1)}. **${fix.title}** (${fix.id})${fix.derivedFrom ? ` · derived from ${fix.derivedFrom.join(', ')}` : ''}${mark(fix.contested)}`,
    `   Plan: ${fix.plan ?? 'None recorded.'}`,
    `   Kind: ${fix.kind ? groundingKindLabels[fix.kind] : 'Not recorded'}. Effort: ${fix.effort ?? 'Not recorded'}. Triage: ${fix.triage}`,
  ]
  if (fix.field) lines.push(`   This changes the PR ${fix.field}, not the code.`)
  if (fix.alsoRaised.length) lines.push(`   Also raised as: ${fix.alsoRaised.join(', ')}.`)
  if (fix.movedFrom)
    lines.push(`   Moved here from PR #${String(fix.movedFrom.layer)}: ${fix.movedFrom.reason}`)
  return lines.join('\n')
}

function mark(contested: boolean): string {
  return contested ? ' (the second model did not approve this)' : ''
}

function section(title: string, lines: string[]): string {
  return lines.length ? `## ${title}\n\n${lines.join('\n')}` : ''
}
