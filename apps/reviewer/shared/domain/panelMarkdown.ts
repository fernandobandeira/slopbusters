import {
  findingTagLabels,
  panelSeverityLabels,
  panelVerdictLabels,
  type JudgeAdvice,
  type PanelAdvice,
  type PanelFinding,
  type PanelReviewer,
  type SetAside,
} from './panel'
import { anchorLabel, type Anchor } from './anchors'

export function panelFindingMarkdown(finding: PanelFinding, raisedBy?: string): string {
  return [
    `**${panelSeverityLabels[finding.severity]} · ${findingTagLabels[finding.tag]}: ${finding.title}**`,
    `${anchorMarkdown(finding.anchor)}${raisedBy ? ` · raised by ${raisedBy}` : ''}`,
    finding.body,
    finding.suggestion && finding.tag !== 'decision'
      ? `**Suggested change**\n\n${finding.suggestion}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** `src/a.ts:12` · updated code, with the path and line in backticks. */
function anchorMarkdown(anchor: Anchor): string {
  const [where = '', ...rest] = anchorLabel(anchor).split(' · ')
  return anchor.kind === 'description' ? where : [`\`${where}\``, ...rest].join(' · ')
}

function setAsideMarkdown(item: SetAside, raisedBy: string): string {
  const where = item.path ? ` · \`${item.path}${item.line ? `:${String(item.line)}` : ''}\`` : ''
  return `- **${item.title}**${where} · raised by ${raisedBy}\n  ${item.body}\n  *Set aside:* ${item.reason}`
}

/** The judged review, for the clipboard. */
export function panelReviewMarkdown(advice: JudgeAdvice, reviewers: PanelReviewer[]): string {
  const names = (ids: string[]) =>
    ids.map((id) => reviewers.find((reviewer) => reviewer.id === id)?.name ?? id).join(', ')
  const notes = [
    ['What reads well', advice.good],
    ['Review limitations', advice.limitations],
    ['Unresolved disagreements', advice.disagreements],
  ] as const
  return [
    `## Review panel: ${panelVerdictLabels[advice.verdict]}\n\n${advice.summary}\n\nReviewers: ${names(reviewers.map((reviewer) => reviewer.id))}`,
    ...advice.findings.map((finding) => panelFindingMarkdown(finding, names(finding.raisedBy))),
    advice.setAside.length
      ? `**Set aside by the judge**\n\n${advice.setAside.map((item) => setAsideMarkdown(item, names(item.raisedBy))).join('\n')}`
      : '',
    ...notes
      .filter(([, entries]) => entries.length)
      .map(
        ([title, entries]) => `**${title}**\n\n${entries.map((entry) => `- ${entry}`).join('\n')}`,
      ),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n')
}

/** What one reviewer said and what the judge did with it, for a chat that continues that reviewer. */
export function panelReviewerMarkdown(
  reviewer: PanelReviewer,
  own: PanelAdvice | undefined,
  judged?: JudgeAdvice,
): string {
  const kept = judged?.findings.filter((finding) => finding.raisedBy.includes(reviewer.id)) ?? []
  const setAside = judged?.setAside.filter((item) => item.raisedBy.includes(reviewer.id)) ?? []
  return [
    own ? `## Your review: ${panelVerdictLabels[own.verdict]}\n\n${own.summary}` : '',
    ...(judged
      ? [
          kept.length
            ? `### Findings the judge kept\n\n${kept.map((finding) => panelFindingMarkdown(finding)).join('\n\n---\n\n')}`
            : '### The judge kept none of your findings.',
          setAside.length
            ? `### Findings the judge set aside\n\n${setAside.map((item) => setAsideMarkdown(item, reviewer.name)).join('\n')}`
            : '',
          `### The judge's verdict: ${panelVerdictLabels[judged.verdict]}\n\n${judged.summary}`,
        ]
      : (own?.findings ?? []).map((finding) => panelFindingMarkdown(finding))),
  ]
    .filter(Boolean)
    .join('\n\n')
}
