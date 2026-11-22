import { useMemo, useState } from 'react'
import type { ChangeGroup, PullRequest } from '../../../shared/domain/types'
import { questionSectionAt, questionSections, type OptionalSections } from './questionSections'
import type { LinePlace } from './transferNotes'

export function useQuestionSections(
  pull: PullRequest,
  selected: ChangeGroup | undefined,
  setFileCollapsed: (fileId: string, collapsed: boolean, groupId?: string) => void,
) {
  const [state, setState] = useState(() => ({
    grouping: pull.groups,
    openSections: new Map<string, Set<OptionalSections>>(),
  }))
  if (state.grouping !== pull.groups) {
    setState({ grouping: pull.groups, openSections: new Map() })
  }
  const { openSections } = state
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
    setState((previous) => {
      const open = new Set(previous.openSections.get(groupId))
      if (open.has(section) === shown) return previous
      if (shown) open.add(section)
      else open.delete(section)
      return { ...previous, openSections: new Map(previous.openSections).set(groupId, open) }
    })
  }
  function revealFileSections(
    fileId: string,
    groupId = selected?.id,
    line?: Omit<LinePlace, 'fileId'>,
  ) {
    const group = pull.groups.find((group) => group.id === groupId)
    const file = pull.files.find((file) => file.id === fileId)
    if (!group?.question || !file) return
    const section = line && questionSectionAt(group, file, line)
    if (section === 'key') return
    if (section) {
      setOpen(group.id, section, true)
      return
    }
    const { supporting, test } = questionSections(group)
    const ids = new Set(file.hunks.map((hunk) => hunk.id))
    if (supporting.some((id) => ids.has(id))) setOpen(group.id, 'supporting', true)
    if (test.some((id) => ids.has(id))) setOpen(group.id, 'test', true)
  }
  function revealFile(fileId: string, groupId = selected?.id, line?: Omit<LinePlace, 'fileId'>) {
    revealFileSections(fileId, groupId, line)
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
  return { sections, open, hidden, visibleGroup, toggle, revealFile, revealFileSections }
}
