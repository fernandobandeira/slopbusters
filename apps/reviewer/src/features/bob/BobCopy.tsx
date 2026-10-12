import { Check, Copy } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  bobSeverityLabels,
  bobVerdictLabels,
  type BobAdvice,
  type BobFinding,
} from '../../../shared/domain/bob'
import { DiffSide } from '../../../shared/domain/types'
import { useClipboard } from '../../lib/useClipboard'

export function BobCopyButton({ label, text }: { label: string; text: string }) {
  const { state, copy } = useClipboard()
  return (
    <Button size="sm" variant="ghost" onClick={() => void copy(text)}>
      {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </Button>
  )
}

export function bobFindingMarkdown(finding: BobFinding): string {
  const side = finding.side === DiffSide.left ? 'original' : 'updated'
  return [
    `**${bobSeverityLabels[finding.severity]}: ${finding.title}**`,
    `\`${finding.path}:${finding.line}\` · ${side} code`,
    finding.body,
    `**Suggested improvement**\n\n${finding.suggestion}`,
  ].join('\n\n')
}

export function bobReviewMarkdown(advice: BobAdvice): string {
  const notes = [
    ['What reads well', advice.good],
    ['Review limitations', advice.limitations],
    ['Unresolved disagreements', advice.disagreements],
  ] as const
  return [
    `## Uncle Bob: ${bobVerdictLabels[advice.verdict]}\n\n${advice.summary}`,
    ...advice.findings.map(bobFindingMarkdown),
    ...notes
      .filter(([, entries]) => entries.length)
      .map(([title, entries]) => `**${title}**\n\n${entries.map((e) => `- ${e}`).join('\n')}`),
  ].join('\n\n---\n\n')
}
