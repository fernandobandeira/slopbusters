import { useMemo, useState } from 'react'
import type { ChangeGroup, PullRequest } from '../../../shared/domain/types'
import { questionSectionAt, questionSections, type OptionalSections } from './questionSections'
import type { LinePlace } from './transferNotes'

export function useQuestionSections(
  pull: PullRequest,
  selected: ChangeGroup | undefined,
  setFileCollapsed: (fileId: string, collapsed: boolean, groupId?: string) => void,
) {
  const [openSections, setOpenSections] = useState(() => new Map<string, Set<OptionalSections>>())
  const sections = useMemo(
    () => (selected?.question ? questionSections(selected) : undefined),
    [selected],
  )
  const open = selected && openSections.get(selected.id)
  const hidden = useMemo(
    () =>
      new Set([
        ...(open?.has('supporting') ? [] : (sections?.supporting ?? [])),
        ...(open?.has('test') ? [] : (sections?.test ?? [])),
      ]),
    [open, sections],
  )
  const visibleGroup = useMemo(
    () =>
      selected && hidden.size
        ? { ...selected, hunkIds: selected.hunkIds.filter((id) => !hidden.has(id)) }
        : selected,
    [selected, hidden],
  )

  function setOpen(groupId: string, section: OptionalSections, shown: boolean) {
    setOpenSections((previous) => {
      const open = new Set(previous.get(groupId))
      if (open.has(section) === shown) return previous
      if (shown) open.add(section)
      else open.delete(section)
      return new Map(previous).set(groupId, open)
    })
  }
  function revealSection(groupId: string | undefined, location: LinePlace) {
    const group = pull.groups.find((group) => group.id === groupId)
    const file = pull.files.find((file) => file.id === location.fileId)
    if (!group?.question || !file) return
    const section = questionSectionAt(group, file, location)
    if (section) setOpen(group.id, section, true)
  }
  function revealFile(fileId: string, groupId = selected?.id, line?: Omit<LinePlace, 'fileId'>) {
    if (line) revealSection(groupId, { fileId, ...line })
    setFileCollapsed(fileId, false, groupId)
  }
  function toggle(section: OptionalSections) {
    if (!selected || !sections) return
    const shown = !open?.has(section)
    setOpen(selected.id, section, shown)
    if (!shown) return
    const ids = new Set(sections[section])
    for (const file of pull.files) {
      if (file.hunks.some((hunk) => ids.has(hunk.id))) setFileCollapsed(file.id, false)
    }
  }
  function revealFileSections(fileId: string) {
    if (!sections || !selected) return
    const file = pull.files.find((file) => file.id === fileId)
    if (!file) return
    const ids = new Set(file.hunks.map((hunk) => hunk.id))
    if (sections.supporting.some((id) => ids.has(id))) setOpen(selected.id, 'supporting', true)
    if (sections.test.some((id) => ids.has(id))) setOpen(selected.id, 'test', true)
  }
  return { sections, open, hidden, visibleGroup, toggle, revealFile, revealFileSections }
}
