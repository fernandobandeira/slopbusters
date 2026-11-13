import { anchorLabel } from '../../../shared/domain/anchors'
import { leadSource, type ResolvedEntry } from '../../../shared/domain/grounding'
import type { PanelResult, PanelSession } from '../../../shared/domain/panelSession'
import { triage } from '../../../shared/domain/triage'

/** Keep ticket prose about the code, without attributing it to a panel member. */
export function followUpContent(session: PanelSession, result: PanelResult, entry: ResolvedEntry) {
  const candidates = result.grounding?.candidates ?? []
  const lead = leadSource(entry, candidates)
  const finding = lead?.finding
  const names = session.reviewers.flatMap((member) => [member.name, member.id]).map(escape)
  const reviewer = names.length ? new RegExp(`\\b(?:${names.join('|')})\\b`, 'g') : undefined
  const clean = (text: string) => (reviewer ? text.replace(reviewer, 'a reviewer') : text)
  const title = clean(finding?.title ?? entry.reason)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*_`#]/g, '')
    .trim()
    .slice(0, 79)
  const notes = candidates
    .filter((candidate) => entry.sources.includes(candidate.key))
    .map(({ finding: source }) =>
      [source.title, source.body, source.suggestion].filter(Boolean).join('\n\n'),
    )
  const lines = [
    finding ? location(result, entry, finding.anchor) : entry.evidence.join(', '),
    `Deferred from the PR: ${triage(entry).reason}`,
    `Grounded reason: ${entry.reason}`,
    entry.plan ? `Plan: ${entry.plan}` : '',
    `From: ${result.pull.url}`,
    '+++ Agent notes',
    ...notes,
    '+++',
  ]
  return { title, description: clean(lines.filter(Boolean).join('\n\n')) }
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function location(
  result: PanelResult,
  entry: ResolvedEntry,
  anchor: NonNullable<ReturnType<typeof leadSource>>['finding']['anchor'],
) {
  const pull = result.pull
  const layer = anchor.kind === 'stack' ? anchor.pull : pull.number
  const sha =
    layer === pull.number
      ? pull.headSha
      : result.grounding?.stack?.find((item) => item.pull === layer)?.headSha
  const point = anchor.kind === 'stack' ? anchor.location : anchor
  if (point.kind === 'description')
    return `PR ${point.field}: ${point.quote ?? entry.evidence.join(', ')}`
  const where = `${point.path}:${String(point.line)}`
  if (!sha) return anchorLabel(anchor)
  const path = point.path.split('/').map(encodeURIComponent).join('/')
  return `[${where}](https://github.com/${pull.owner}/${pull.repo}/blob/${sha}/${path}#L${String(point.line)})`
}
