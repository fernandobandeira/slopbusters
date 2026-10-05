import { useState, type Dispatch, type SetStateAction } from 'react'
import {
  DiffSide,
  type ChangeGroup,
  type DraftComment,
  type PullRequest,
  type ReviewDraft,
} from '../../../shared/domain/types'
import type { ReviewView } from '../../lib/routes'
import { discussionGroup } from './discussions/discussions'
interface EditorOptions {
  selected?: ChangeGroup
  changeView: (changes: Partial<ReviewView>) => void
  setFileCollapsed: (fileId: string, collapsed: boolean, groupId?: string) => void
  setDraft: Dispatch<SetStateAction<ReviewDraft>>
  setNotice: (message: string) => void
  setSubmitted: (url: string | undefined) => void
}
export function useCommentEditor(pull: PullRequest, options: EditorOptions) {
  const { selected, changeView, setFileCollapsed, setDraft, setNotice, setSubmitted } = options
  const [editor, setEditor] = useState<Omit<DraftComment, 'body'> | null>(null)
  const [body, setBody] = useState('')
  function editComment(comment: DraftComment) {
    const file = pull.files.find((file) => file.path === comment.path)
    if (!file) return
    const group = discussionGroup({
      pull,
      path: comment.path,
      line: comment.line,
      side: comment.side,
    })
    if (!group) {
      setNotice('Organize changes before editing line comments.')
      return
    }
    setFileCollapsed(file.id, false, group.id)
    changeView({ groupId: group.id })
    setEditor(comment)
    setBody(comment.body)
  }
  function deleteComment(comment: DraftComment) {
    setDraft((previous) => ({
      ...previous,
      comments: previous.comments.filter((item) => item.id !== comment.id),
    }))
  }
  function addComment(location: { path: string; line: number; side: DiffSide; code?: string }) {
    if (!selected) return
    setBody('')
    setEditor({
      id: crypto.randomUUID(),
      headSha: pull.headSha,
      ...location,
    })
  }
  function commentOnLine(params: { fileId: string; line: number; side: DiffSide }) {
    const file = pull.files.find((file) => file.id === params.fileId)
    const source = file?.hunks
      .flatMap((hunk) => hunk.lines)
      .find((line) =>
        params.side === DiffSide.left ? line.oldLine === params.line : line.newLine === params.line,
      )
    if (file && source)
      addComment({ path: file.path, line: params.line, side: params.side, code: source.text })
  }
  function saveComment() {
    if (!editor || !body.trim()) return
    const comment = { ...editor, body: body.trim() }
    setDraft((previous) => ({
      ...previous,
      comments: [...previous.comments.filter((item) => item.id !== comment.id), comment],
    }))
    setEditor(null)
    setSubmitted(undefined)
  }
  return {
    editor,
    setEditor,
    body,
    setBody,
    editComment,
    deleteComment,
    addComment,
    commentOnLine,
    saveComment,
  }
}
