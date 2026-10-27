import { describe, expect, it } from 'vitest'
import { DiffSide, TransferKind } from '../shared/domain/types'
import { annotateDiscussions } from '../src/features/review/discussions/discussions'
import { diffItems } from '../src/features/review/diff/diffItems'
import {
  annotateTransfers,
  transferCounts,
  transferRows,
} from '../src/features/review/transferNotes'
import { transferPull } from './fixtures/transfers'

function annotate(
  groupId: string,
  comments: Parameters<typeof annotateDiscussions>[0]['comments'],
) {
  const pull = transferPull()
  const group = pull.groups.find((candidate) => candidate.id === groupId)
  if (!group) throw new Error(`Missing group ${groupId}`)
  const discussed = annotateDiscussions({
    items: diffItems(pull, group),
    pull,
    comments,
    editor: null,
  })
  const items = annotateTransfers(discussed.items, pull)
  const [source, destination] = pull.files
  const annotations = (fileId?: string) =>
    items.find((item) => item.id === fileId)?.annotations ?? []
  return { pull, source: annotations(source?.id), destination: annotations(destination?.id) }
}

describe('transfer notes', () => {
  it('puts a card under the last displayed line of each end, pointing at the other', () => {
    const { pull, source, destination } = annotate('both', [])
    const [oldFile, newFile] = pull.files

    expect(source).toMatchObject([
      {
        side: 'deletions',
        lineNumber: 13,
        metadata: {
          kind: 'transfer',
          end: 'source',
          counterpart: { fileId: newFile?.id, side: DiffSide.right, line: 24, below: true },
        },
      },
    ])
    expect(destination).toMatchObject([
      {
        side: 'additions',
        lineNumber: 24,
        metadata: {
          end: 'destination',
          counterpart: { fileId: oldFile?.id, side: DiffSide.left, line: 13, below: false },
        },
      },
    ])
    expect(transferCounts(destination)).toEqual({ moved: 1, copied: 0 })
  })

  it('shows no card or jump for an end the group does not display', () => {
    const { source, destination } = annotate('destination', [])

    expect(source).toEqual([])
    expect(destination).toHaveLength(1)
    expect(destination[0]?.metadata).not.toHaveProperty('counterpart')
  })

  it('keeps a discussion on the same line and side next to the card', () => {
    const pull = transferPull()
    const comment = {
      id: 'draft',
      headSha: pull.headSha,
      path: 'src/new.ts',
      line: 24,
      side: DiffSide.right,
      body: 'Why move this?',
    }

    const { destination } = annotate('both', [comment])

    expect(
      destination.map((note) => [
        'side' in note ? note.side : 'file',
        note.lineNumber,
        note.metadata.kind,
      ]),
    ).toEqual([
      ['additions', 24, 'transfer'],
      ['additions', 24, 'discussion'],
    ])
  })
})

describe('transfer rows', () => {
  it('tints the moved lines on both sides but leaves the lines edited on the way', () => {
    const pull = transferPull()
    const [source, destination] = pull.files

    const rows = transferRows(pull)

    expect([...(rows.get(source?.id ?? '')?.keys() ?? [])]).toEqual([
      'LEFT:10',
      'LEFT:11',
      'LEFT:13',
    ])
    expect([...(rows.get(destination?.id ?? '')?.entries() ?? [])]).toEqual([
      ['RIGHT:21', TransferKind.moved],
      ['RIGHT:22', TransferKind.moved],
      ['RIGHT:24', TransferKind.moved],
    ])
  })
})
