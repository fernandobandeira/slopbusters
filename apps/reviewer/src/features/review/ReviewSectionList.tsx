import {
  DiffSide,
  LineKind,
  type ChangeGroup,
  type PullRequest,
  type ReviewDraft,
} from '../../../shared/domain/types'
import type { ReviewLocation } from '../../../shared/domain/review'
import { sectionUpdateLabels, type ReviewChanges } from '../../../shared/domain/reviewChanges'
import { reviewedHunkIds } from './reviewProgress'

interface Props {
  pull: PullRequest
  group?: ChangeGroup
  draft: ReviewDraft
  changes?: ReviewChanges
  onView: (ids: string[]) => void
  onFocus: (location: ReviewLocation) => void
}
export function ReviewSectionList({ pull, group, draft, changes, onView, onFocus }: Props) {
  if (!group) return null
  const viewed = reviewedHunkIds(pull, draft)
  const states = new Map(changes?.sections.map((section) => [section.hunkId, section.state]))
  const sections = pull.files.flatMap((file) =>
    file.hunks.filter((hunk) => group.hunkIds.includes(hunk.id)).map((hunk) => ({ file, hunk })),
  )
  if (!sections.length) return null
  return (
    <details className="review-section-list" open>
      <summary>Sections in this group ({sections.length})</summary>
      <div>
        {sections.map(({ file, hunk }) => {
          const line = hunk.lines.find((line) => line.kind !== LineKind.context)
          const state = states.get(hunk.id)
          const number = line?.newLine ?? line?.oldLine ?? 1
          return (
            <div className="review-section-row" key={hunk.id}>
              <label>
                <input
                  type="checkbox"
                  checked={viewed.has(hunk.id)}
                  aria-label={`Viewed section ${file.path}:${number}`}
                  onChange={() => {
                    onView([hunk.id])
                  }}
                />
                Viewed
              </label>
              <button
                type="button"
                onClick={() => {
                  onFocus({
                    path: file.path,
                    line: number,
                    side: line?.newLine == null ? DiffSide.left : DiffSide.right,
                  })
                }}
              >
                {file.path}:{number}
              </button>
              <span className={state ? 'section-update' : 'muted'}>
                {state
                  ? sectionUpdateLabels[state]
                  : viewed.has(hunk.id)
                    ? 'Already viewed'
                    : 'Not yet viewed'}
              </span>
            </div>
          )
        })}
      </div>
    </details>
  )
}
