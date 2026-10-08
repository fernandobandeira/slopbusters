import { sectionUpdateLabels } from '../../../shared/domain/reviewChanges'
import type { SectionMarker } from './discussions/discussions'
import { MARK_SECTION_KEY } from './useSectionCursor'

/** A section's review control, drawn under its last edited line inside the diff. */
export function SectionBar({
  section,
  onToggle,
}: {
  section: SectionMarker
  onToggle: (hunkId: string) => void
}) {
  return (
    <div
      className="section-bar"
      data-viewed={section.viewed || undefined}
      data-current={section.current || undefined}
    >
      <label title={`Mark this section viewed (${MARK_SECTION_KEY.toUpperCase()})`}>
        <input
          type="checkbox"
          checked={section.viewed}
          aria-label={`Viewed section ${section.path}:${section.line}`}
          onChange={() => {
            onToggle(section.hunkId)
          }}
        />
        Viewed
      </label>
      {section.state && (
        <span className="section-update">{sectionUpdateLabels[section.state]}</span>
      )}
      {section.current && !section.viewed && (
        <span className="section-bar-hint muted">
          Press <kbd>{MARK_SECTION_KEY.toUpperCase()}</kbd> to mark viewed
        </span>
      )}
    </div>
  )
}
