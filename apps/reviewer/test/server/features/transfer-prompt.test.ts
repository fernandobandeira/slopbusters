import { describe, expect, it, vi } from 'vitest'
import { createTwoFilesPatch } from 'diff'
import { parseFile } from '../../../server/features/diff'
import { detectTransfers } from '../../../server/features/transfers'
import { reviewEvidence } from '../../../server/reviewSnapshot'
import { reviewWithBob } from '../../../server/features/bob/bobReview'
import { organizePull } from '../../../server/features/organization/organize'
import { anchorProblem } from '../../../shared/domain/anchors'
import { DiffSide, Provider, type PullRequest } from '../../../shared/domain/types'
import { fixtureBobAdvice, required } from '../../fixtures/bob'
import { fixturePull } from '../../fixtures/pull'
import { recordingTurns } from '../../fixtures/turns'

const block =
  'export function slug(value: string) {\n  return value.trim()\n    .toLowerCase()\n    .replace(/[^a-z0-9]+/g, "-")\n    .replace(/^-|-$/g, "");\n}\n'
const model = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const signal = new AbortController().signal

interface EvidenceLine {
  kind: string
  text: string
  oldLine: number | null
  newLine: number | null
  endLine?: number
}
interface Evidence {
  files: { path: string; hunks: { id: string; lines: EvidenceLine[] }[] }[]
  transfers?: { exact: boolean; editsInsideBlock?: { header: string }[] }[]
}

describe('moved code in review evidence', () => {
  it('collapses a block moved unchanged into markers on both sides', () => {
    const pull = pullOf([changedFile('utils.ts', block, ''), changedFile('slug.ts', '', block)])

    const evidence = parse(reviewEvidence(pull))

    expect(linesOf(evidence, 'slug.ts')).toEqual([
      {
        kind: 'moved',
        text: '[moved unchanged from utils.ts:1–6; 6 lines — review its new context, not its text]',
        oldLine: null,
        newLine: 1,
        endLine: 6,
      },
    ])
    expect(linesOf(evidence, 'utils.ts')).toEqual([
      { kind: 'moved', text: '[moved to slug.ts:1–6]', oldLine: 1, newLine: null, endLine: 6 },
    ])
    expect(evidence.transfers).toMatchObject([{ exact: true }])
  })
  it('keeps an edited block behind its marker and lists the edits made inside it', () => {
    const pull = pullOf([
      changedFile('utils.ts', block, ''),
      changedFile('slug.ts', '', block.replace('trim()', 'trimEnd()')),
    ])

    const evidence = parse(reviewEvidence(pull))

    const destination = linesOf(evidence, 'slug.ts')
    expect(destination[0]).toMatchObject({ kind: 'moved', newLine: 1, endLine: 6 })
    expect(destination[0]?.text).toContain('with 1 edited of 6 lines')
    expect(destination.slice(1).map((line) => line.text)).toEqual(
      block.trimEnd().replace('trim()', 'trimEnd()').split('\n'),
    )
    expect(linesOf(evidence, 'utils.ts')).toMatchObject([
      { text: '[moved to slug.ts:1–6, edited]', oldLine: 1, endLine: 6 },
    ])
    expect(evidence.transfers?.[0]?.editsInsideBlock).toMatchObject([{ header: '@@ -1,4 +1,4 @@' }])
  })
  it('still places findings on the lines a marker stands for', () => {
    const pull = pullOf([changedFile('utils.ts', block, ''), changedFile('slug.ts', '', block)])
    const hunk = (path: string) =>
      required(parse(reviewEvidence(pull)).files.find((file) => file.path === path)?.hunks[0]).id

    expect(
      anchorProblem(
        { kind: 'change', path: 'slug.ts', hunkId: hunk('slug.ts'), line: 4, side: DiffSide.right },
        { pull },
      ),
    ).toBeUndefined()
    expect(
      anchorProblem(
        {
          kind: 'change',
          path: 'utils.ts',
          hunkId: hunk('utils.ts'),
          line: 6,
          side: DiffSide.left,
        },
        { pull },
      ),
    ).toBeUndefined()
  })
})

describe('moved code in model prompts', () => {
  it('explains the markers to a reviewer and to the organizer', async () => {
    const pull = fixturePull()
    const review = recordingTurns(() => fixtureBobAdvice())
    const organize = recordingTurns(() => ({
      groups: pull.groups.map(({ title, priority, reason, hunkIds }) => ({
        title,
        priority,
        reason,
        hunkIds,
      })),
    }))

    await reviewWithBob({
      turns: review.turns,
      pull,
      model,
      skill: 'Bob',
      signal,
      companion: false,
    })
    await organizePull(organize.turns, pull, model, { signal, observer: vi.fn() })

    const reviewPrompt = required(review.requests[0]).prompt
    const organizePrompt = required(organize.requests[0]).prompt
    expect(reviewPrompt).toContain('a line of kind moved or copied is a marker')
    expect(reviewPrompt).toContain('[moved unchanged from src/lib/utils.ts:')
    expect(organizePrompt).toContain('A code line of kind moved or copied is a marker')
    expect(organizePrompt).toContain('moved: [moved to src/lib/slug.ts:')
  })
  it('leaves prompts without transfers as they were', async () => {
    const pull = { ...fixturePull(), transfers: [] }
    const review = recordingTurns(() => fixtureBobAdvice())

    await reviewWithBob({
      turns: review.turns,
      pull,
      model,
      skill: 'Bob',
      signal,
      companion: false,
    })

    const prompt = required(review.requests[0]).prompt
    expect(prompt).not.toContain('kind moved or copied')
    expect(prompt).not.toContain('"transfers"')
  })
})

function pullOf(files: PullRequest['files']): PullRequest {
  return { ...fixturePull(), files, transfers: detectTransfers(files) }
}

function changedFile(path: string, old: string, current: string) {
  const raw = createTwoFilesPatch(path, path, old, current)
  const patch = raw.slice(raw.indexOf('@@'))
  const additions = patch.split('\n').filter((line) => line.startsWith('+')).length
  const deletions = patch.split('\n').filter((line) => line.startsWith('-')).length
  return parseFile({ path, status: 'modified', patch, additions, deletions, oldContent: old })
}

function parse(evidence: string): Evidence {
  return JSON.parse(evidence) as Evidence
}

function linesOf(evidence: Evidence, path: string): EvidenceLine[] {
  return (evidence.files.find((file) => file.path === path)?.hunks ?? []).flatMap(
    (hunk) => hunk.lines,
  )
}
