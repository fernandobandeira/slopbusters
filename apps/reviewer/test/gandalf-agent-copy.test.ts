import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ConflictWorkspace } from '../server/adapters/conflictWorkspace'
import { hardenedGit } from '../server/adapters/git'
import { copyForInspection } from '../server/adapters/inspectionCopy'
import { conflictRemote } from './fixtures/conflictRemote'

const repository = conflictRemote()

describe('resolution reports', () => {
  it('reports a resolution that applies cleanly with no problems', async () => {
    const work = await repository.open()
    expect(await work.apply([{ path: 'code.ts', content: 'resolved\n' }])).toEqual({
      changedPaths: ['code.ts'],
      problems: [],
    })
    expect((await work.inspect()).conflicts).toEqual([{ path: 'code.ts', state: 'resolved' }])
  })
})

describe('resolution in an agent copy', () => {
  async function agentCopy(work: ConflictWorkspace) {
    const copy = join(repository.state.directory, 'agent-copy')
    await copyForInspection(work.directory, copy, undefined, { git: true })
    return copy
  }
  it('gives the agent the merge history and applies the files it edited in place', async () => {
    const work = await repository.open()
    const copy = await agentCopy(work)
    expect((await hardenedGit(copy, ['diff', '--name-only', '--diff-filter=U'])).trim()).toBe(
      'code.ts',
    )
    await writeFile(join(copy, 'code.ts'), 'export const value = "head-and-base"\n')
    await mkdir(join(copy, '.slopbusters'))
    await writeFile(join(copy, '.slopbusters', 'instructions.md'), 'runner file\n')
    // The copy's own Git metadata is the agent's to break; Gandalf never reads it.
    await rm(join(copy, '.git', 'index'))
    expect(await work.absorb(copy, { edits: [], selections: [] })).toEqual({
      changedPaths: ['code.ts'],
      problems: [],
    })
    const resolved = await work.publish()
    expect(await repository.git(['show', `${resolved}:code.ts`])).toBe(
      'export const value = "head-and-base"\n',
    )
    expect(await repository.git(['ls-tree', '--name-only', resolved])).toBe('code.ts\n')
  })
  it('sends conflicts the agent left back as problems and applies nothing else', async () => {
    const work = await repository.open()
    const copy = await agentCopy(work)
    const absorbed = await work.absorb(copy, { edits: [], selections: [] })
    expect(absorbed.changedPaths).toEqual([])
    expect(absorbed.problems).toEqual([expect.stringContaining('still unresolved: code.ts')])
  })
  it('treats a deleted file in the copy as a deletion', async () => {
    const work = await repository.open()
    const copy = await agentCopy(work)
    await rm(join(copy, 'code.ts'))
    expect(await work.absorb(copy, { edits: [], selections: [] })).toEqual({
      changedPaths: ['code.ts'],
      problems: [],
    })
    expect((await work.inspect()).conflicts).toEqual([{ path: 'code.ts', state: 'deleted' }])
  })
  it('refuses new files in a conflict resolution', async () => {
    const work = await repository.open()
    const copy = await agentCopy(work)
    await writeFile(join(copy, 'code.ts'), 'resolved\n')
    await writeFile(join(copy, 'scratch.ts'), 'notes\n')
    const absorbed = await work.absorb(copy, { edits: [], selections: [] })
    expect(absorbed.changedPaths).toEqual(['code.ts'])
    expect(absorbed.problems).toEqual([expect.stringContaining('unsupported file: scratch.ts')])
  })
  it('names the commits on each side and keeps every version of a conflicted file', async () => {
    const work = await repository.open()
    expect(work.merge.commits.pull).toEqual([expect.stringMatching(/ Fixture: Feature$/)])
    expect(work.merge.commits.base).toEqual([expect.stringMatching(/ Fixture: Base$/)])
    const views = join(work.merge.views ?? '', 'code.ts')
    expect(await readFile(join(views, 'ancestor'), 'utf8')).toContain('original')
    expect(await readFile(join(views, 'pull'), 'utf8')).toContain('head')
    expect(await readFile(join(views, 'base'), 'utf8')).toContain('base')
    expect(await readFile(join(views, 'base.diff'), 'utf8')).toContain(
      '+export const value = "base"',
    )
    await work.close()
    await expect(lstat(work.merge.views ?? '')).rejects.toThrow()
  })
})
