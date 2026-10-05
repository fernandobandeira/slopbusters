import { useMemo } from 'react'
import { X } from 'lucide-react'
import { StyledDiffCodeView } from '~/components/diffs/StyledDiffCodeView'
import { bobSeverityLabels, type BobFinding, type BobResult } from '../../../shared/domain/bob'
import { DiffSide, Priority } from '../../../shared/domain/types'
import { diffItems } from '../../lib/diffItems'
import { useReviewerTheme } from '../../app/ThemeProvider'

export function BobEvidence({
  result,
  finding,
  onClose,
}: {
  result: BobResult
  finding: BobFinding
  onClose: () => void
}) {
  const { themeId, resolvedTheme } = useReviewerTheme()
  const file = result.pull.files.find((file) => file.path === finding.path)
  const items = useMemo(
    () =>
      diffItems(result.pull, {
        id: finding.hunkId,
        title: finding.path,
        priority: Priority.normal,
        reason: '',
        fileIds: file ? [file.id] : [],
        hunkIds: [finding.hunkId],
      }),
    [result.pull, finding.hunkId, finding.path, file],
  )
  return (
    <section className="bob-evidence" aria-label="Bob finding evidence">
      <header>
        <div>
          <span className="linus-eyebrow">BOB · {bobSeverityLabels[finding.severity]}</span>
          <h2>{finding.title}</h2>
        </div>
        <button className="linus-icon-button" aria-label="Close Bob evidence" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <p className="bob-location">
        {finding.path}:{finding.line} ({finding.side}) · Reviewed {result.pull.headSha.slice(0, 8)}
      </p>
      <StyledDiffCodeView
        key={finding.hunkId}
        className="linus-diff"
        items={items}
        selectedLines={
          file
            ? {
                id: file.id,
                range: {
                  start: finding.line,
                  end: finding.line,
                  side: finding.side === DiffSide.left ? 'deletions' : 'additions',
                },
              }
            : null
        }
        options={{
          theme: themeId,
          themeType: resolvedTheme,
          diffStyle: 'unified',
          overflow: 'wrap',
        }}
      />
      <div className="bob-suggestion">
        <strong>Suggested improvement</strong>
        <pre>{finding.suggestion}</pre>
      </div>
    </section>
  )
}
