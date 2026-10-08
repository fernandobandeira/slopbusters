import { Badge } from '~/components/ui/badge'
import { jobsSeverityLabels, type JobsAdvice } from '../../../shared/domain/jobs'
import { TicketMarkdown } from '../../components/TicketMarkdown'

const severityVariant = { blocking: 'error', important: 'warning', polish: 'outline' } as const

export function JobsFindings({ advice }: { advice: JobsAdvice }) {
  return (
    <div className="jobs-findings">
      {advice.findings.length === 0 && <p className="muted">Nothing to fix in how it reads.</p>}
      {advice.findings.map((finding) => (
        <article key={finding.id} className="jobs-finding">
          <header>
            <Badge variant={severityVariant[finding.severity]}>
              {jobsSeverityLabels[finding.severity]}
            </Badge>
            <strong>{finding.title}</strong>
          </header>
          {finding.reference && <blockquote>{finding.reference}</blockquote>}
          <TicketMarkdown markdown={finding.body} label={finding.title} />
        </article>
      ))}
      <JobsCaveats advice={advice} />
    </div>
  )
}

function JobsCaveats({ advice }: { advice: JobsAdvice }) {
  const sections = [
    ['Claims Jobs could not verify', advice.unverified],
    ['Limitations', advice.limitations],
    ['Unresolved disagreements', advice.disagreements],
  ] as const
  return sections
    .filter(([, items]) => items.length)
    .map(([title, items]) => (
      <details key={title} className="jobs-caveats">
        <summary>
          {title} ({items.length})
        </summary>
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </details>
    ))
}
