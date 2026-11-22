import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ChangeGroup, PullRequest } from '../../../shared/domain/types'
import { sectionLineCount, type OptionalSections, type questionSections } from './questionSections'
import './reviewQuestions.css'

const optionalSections: OptionalSections[] = ['supporting', 'test']

export function ReviewQuestion({
  pull,
  group,
  sections,
  open,
  hiddenCounts,
  onToggle,
}: {
  pull: PullRequest
  group: ChangeGroup
  sections: ReturnType<typeof questionSections>
  open?: ReadonlySet<OptionalSections>
  hiddenCounts?: Readonly<Record<OptionalSections, number>>
  onToggle: (section: OptionalSections) => void
}) {
  return (
    <div className="review-question">
      {group.claim && <p className="review-question-claim">{group.claim}</p>}
      <h2>{group.question}</h2>
      <div className="review-question-sections">
        {optionalSections.map((section) => {
          const ids = sections[section]
          if (!ids.length) return null
          const expanded = open?.has(section) ?? false
          const Chevron = expanded ? ChevronDown : ChevronRight
          const count = hiddenCounts?.[section] ?? 0
          const lines = sectionLineCount(pull, group, ids)
          return (
            <button
              key={section}
              type="button"
              aria-expanded={expanded}
              onClick={() => {
                onToggle(section)
              }}
            >
              <Chevron size={14} aria-hidden="true" />
              {expanded ? 'Hide' : 'Show'} {ids.length} {section}{' '}
              {ids.length === 1 ? 'section' : 'sections'}{' '}
              <span className="muted">
                {lines.toLocaleString()} {lines === 1 ? 'line' : 'lines'}
              </span>
              {!expanded && count > 0 && (
                <span>
                  {count.toLocaleString()} {count === 1 ? 'discussion' : 'discussions'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
