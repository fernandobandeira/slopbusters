import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hardenedGit } from '../server/adapters/git'
import { openConflictWorkspace, type ConflictWorkspace } from '../server/adapters/conflictWorkspace'
import type { GitHub } from '../server/adapters/github'
import { fixturePull } from './fixtures/pull'

let directory: string
let remote: string
let originalHead: string
let originalBase: string
let workspace: ConflictWorkspace | undefined
const rest = vi.fn<GitHub['rest']>()
const github: GitHub = { rest, paginate: vi.fn(), graphql: vi.fn() }
function git(args: string[]) {
  return hardenedGit(remote, args)
}
async function commit(content: string, message: string) {
  await writeFile(join(remote, 'code.ts'), content)
  await git(['add', 'code.ts'])
  await git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.com',
    'commit',
    '-qm',
    message,
  ])
  return (await git(['rev-parse', 'HEAD'])).trim()
}
function metadata() {
  return {
    state: 'open',
    head: { sha: originalHead, ref: 'feature', repo: { full_name: 'review-room/example' } },
    base: { sha: originalBase },
  }
}
async function open() {
  workspace = await openConflictWorkspace({
    dataDirectory: directory,
    pull: { ...fixturePull(), headSha: originalHead, baseSha: originalBase },
    github,
    signal: new AbortController().signal,
    remoteUrl: () => remote,
  })
  return workspace
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'gandalf-git-'))
  remote = join(directory, 'remote')
  await hardenedGit(directory, ['init', '--template=', '--initial-branch=main', remote])
  await commit('export const value = "original"\n', 'Initial')
  await git(['checkout', '-qb', 'feature'])
  originalHead = await commit('export const value = "head"\n', 'Feature')
  await git(['checkout', '-q', 'main'])
  originalBase = await commit('export const value = "base"\n', 'Base')
  rest.mockReset().mockImplementation(() => Promise.resolve(metadata()))
})
afterEach(async () => {
  await workspace?.close()
  workspace = undefined
  await rm(directory, { recursive: true, force: true })
})

describe('isolated conflict checkout and publication', () => {
  it('merges both histories and publishes only the reviewed resolution to the PR branch', async () => {
    const work = await open()
    expect(work.conflicts).toEqual(['code.ts'])
    expect((await work.inspect()).conflicts[0]?.content).toContain('<<<<<<<')
    await work.apply([{ path: 'code.ts', content: 'export const value = "head-and-base"\n' }])
    const resolved = await work.publish()
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(resolved)
    expect(
      (await git(['rev-list', '--first-parent', `${originalHead}..${resolved}`]))
        .trim()
        .split('\n'),
    ).toEqual([resolved])
    expect((await git(['show', '-s', '--format=%P', resolved])).trim()).toBe(
      `${originalHead} ${originalBase}`,
    )
    expect(await git(['show', `${resolved}:code.ts`])).toBe(
      'export const value = "head-and-base"\n',
    )
    expect(await readFile(join(remote, 'code.ts'), 'utf8')).toBe('export const value = "base"\n')
  })
  it('rejects changed heads or bases before publication', async () => {
    const work = await open()
    await work.apply([{ path: 'code.ts', content: 'resolved\n' }])
    rest.mockResolvedValue({ ...metadata(), base: { sha: 'f'.repeat(40) } })
    await expect(work.publish()).rejects.toThrow('changed during conflict resolution')
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(originalHead)
  })
  it('atomically refuses to overwrite a concurrently updated PR head even if metadata is stale', async () => {
    const work = await open()
    await work.apply([{ path: 'code.ts', content: 'resolved\n' }])
    await git(['checkout', '-q', 'feature'])
    const concurrent = await commit('concurrent\n', 'Concurrent update')
    await git(['checkout', '-q', 'main'])
    await expect(work.publish()).rejects.toThrow()
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(concurrent)
  })
  it('rejects traversal, Git metadata, unknown files and unresolved markers', async () => {
    const work = await open()
    for (const path of ['../escape', '.git/config', 'new-file.ts']) {
      await expect(work.apply([{ path, content: 'bad' }])).rejects.toThrow('unsupported file')
    }
    await expect(work.apply([{ path: 'code.ts', content: '<<<<<<< HEAD\nbad\n' }])).rejects.toThrow(
      'conflict markers',
    )
    await expect(work.apply([])).rejects.toThrow('unresolved conflicts')
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(originalHead)
  })
  it('supports intentional file deletion during resolution', async () => {
    const work = await open()
    await work.apply([{ path: 'code.ts', content: null }])
    const resolved = await work.publish()
    expect(await git(['ls-tree', '--name-only', resolved])).toBe('')
  })
})
