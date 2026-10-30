import { mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hardenedGit } from '../server/adapters/git'
import type { GitHub } from '../server/adapters/github'
import {
  branchName,
  LayerBuildError,
  openSplitWorkspace,
  type SplitWorkspace,
} from '../server/adapters/splitWorkspace'
import { parseUnits } from '../shared/domain/splitUnits'
import { planProblems } from '../shared/domain/split'
import { fixturePull } from './fixtures/pull'

const identity = { name: 'Fixture Author', email: 'author@example.com' }
let directory: string
let remote: string
let head: string
let base: string
let workspace: SplitWorkspace | undefined
const rest = vi.fn<GitHub['rest']>()
const github: GitHub = { rest, paginate: vi.fn(), graphql: vi.fn() }
const git = (args: string[]) => hardenedGit(remote, args)
const lines = (count: number, prefix: string) =>
  Array.from({ length: count }, (_, index) => `${prefix} ${String(index + 1)}`).join('\n') + '\n'

async function commit(message: string) {
  await git(['add', '-A'])
  await git([
    '-c',
    `user.name=${identity.name}`,
    '-c',
    `user.email=${identity.email}`,
    'commit',
    '-qm',
    message,
  ])
  return (await git(['rev-parse', 'HEAD'])).trim()
}
async function open() {
  workspace = await openSplitWorkspace({
    dataDirectory: directory,
    pull: { ...fixturePull(), headBranch: 'feature', headSha: head, baseSha: base },
    github,
    signal: new AbortController().signal,
    remoteUrl: () => remote,
  })
  return workspace
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'split-git-'))
  remote = join(directory, 'remote')
  await hardenedGit(directory, ['init', '--template=', '--initial-branch=main', remote])
  await writeFile(join(remote, 'a.ts'), lines(40, 'line'))
  await writeFile(join(remote, 'c.ts'), 'export const gone = true\n')
  await commit('Initial')
  await git(['checkout', '-qb', 'feature'])
  // Two changes far apart in a.ts, a new file, and a deleted file.
  const edited = lines(40, 'line').split('\n')
  edited[2] = 'line 3 changed'
  edited[35] = 'line 36 changed'
  await writeFile(join(remote, 'a.ts'), edited.join('\n'))
  await writeFile(join(remote, 'b.ts'), 'export const added = 1\n')
  await unlink(join(remote, 'c.ts'))
  head = await commit('Feature')
  await git(['checkout', '-q', 'main'])
  await writeFile(join(remote, 'd.ts'), 'export const unrelated = 1\n')
  base = await commit('Base moved on')
  rest.mockReset().mockImplementation((endpoint: string) => {
    if (endpoint.includes('/git/ref/heads/')) {
      const branch = endpoint.slice(endpoint.lastIndexOf('/heads/') + 7)
      return git(['rev-parse', `refs/heads/${branch}`]).then((sha) => ({
        object: { sha: sha.trim() },
      }))
    }
    const repo = { full_name: 'review-room/example' }
    return Promise.resolve({
      state: 'open',
      head: { ref: 'feature', repo },
      base: { ref: 'main', repo },
    })
  })
})
afterEach(async () => {
  await workspace?.close()
  workspace = undefined
  await rm(directory, { recursive: true, force: true })
})

describe('cutting a PR into units', () => {
  it('makes a unit of each hunk of a modified file and of each added or deleted file', async () => {
    const opened = await open()

    expect(opened.baseSha).not.toBe(base)
    expect(opened.units.map(({ id, path, kind, header }) => ({ id, path, kind, header }))).toEqual([
      { id: 'u1', path: 'a.ts', kind: 'hunk', header: '@@ -1,6 +1,6 @@' },
      { id: 'u2', path: 'a.ts', kind: 'hunk', header: '@@ -33,7 +33,7 @@ line 32' },
      { id: 'u3', path: 'b.ts', kind: 'file', header: 'added' },
      { id: 'u4', path: 'c.ts', kind: 'file', header: 'deleted' },
    ])
    expect(opened.patch('u3')).toContain('+export const added = 1')
  })

  it('keeps a renamed file as one unit', () => {
    const units = parseUnits(
      'diff --git a/old.ts b/new.ts\nsimilarity index 90%\nrename from old.ts\nrename to new.ts\nindex 1..2 100644\n--- a/old.ts\n+++ b/new.ts\n@@ -1 +1 @@\n-a\n+b\n',
    )
    expect(units).toMatchObject([
      { path: 'new.ts', previousPath: 'old.ts', kind: 'file', header: 'renamed' },
    ])
  })
})

describe('building the stack', () => {
  const plan = [
    { title: 'First change and the new file', description: 'Why one.', units: ['u1', 'u3'] },
    { title: 'Second change, drop the old file', description: 'Why two.', units: ['u2', 'u4'] },
  ]
  it('commits each layer on the one below from the merge base, adding up to the PR head', async () => {
    const opened = await open()

    const layers = await opened.build(plan, identity)

    expect(layers.map((layer) => layer.branch)).toEqual([
      'feature-1-first-change-and-the-new-file',
      'feature-2-second-change-drop-the-old-file',
    ])
    expect(layers.map(({ additions, deletions }) => ({ additions, deletions }))).toEqual([
      { additions: 2, deletions: 1 },
      { additions: 1, deletions: 2 },
    ])
    const local = (args: string[]) => hardenedGit(opened.directory, args)
    expect((await local(['rev-parse', `${layers[0]?.sha ?? ''}^`])).trim()).toBe(opened.baseSha)
    expect((await local(['rev-parse', `${layers[1]?.sha ?? ''}^`])).trim()).toBe(layers[0]?.sha)
    expect((await local(['rev-parse', `${layers[1]?.sha ?? ''}^{tree}`])).trim()).toBe(
      (await local(['rev-parse', `${head}^{tree}`])).trim(),
    )
    expect((await local(['log', '-1', '--format=%B', layers[0]?.sha ?? ''])).trim()).toBe(
      'First change and the new file\n\nWhy one.',
    )
    expect(await local(['show', '--stat', '--format=', layers[0]?.sha ?? ''])).toContain('b.ts')
  })

  it('refuses a cut whose layer does not apply, naming the layer and file', async () => {
    const opened = await open()
    // A hunk cannot apply twice: the second layer's copy of u1 finds the lines already changed.
    const twice = [
      { title: 'One', description: 'd', units: ['u1', 'u3', 'u4'] },
      { title: 'Two', description: 'd', units: ['u1', 'u2'] },
    ]
    expect(planProblems(twice, opened.units)).toEqual([
      'Unit u1 is in layer 1 and layer 2; it can be in one.',
    ])

    await expect(opened.build(twice, identity)).rejects.toThrow(LayerBuildError)
    await expect(opened.build(twice, identity)).rejects.toThrow(
      /Layer 2 "Two" does not apply to a\.ts/,
    )
  })

  it('pushes each layer’s branch, and moves a branch it pushed before', async () => {
    const opened = await open()
    const layers = await opened.build(plan, identity)

    await opened.publish(layers, [])

    expect(
      (await git(['rev-parse', 'refs/heads/feature-1-first-change-and-the-new-file'])).trim(),
    ).toBe(layers[0]?.sha)
    const recut = await opened.build(
      [
        {
          title: 'First change and the new file',
          description: 'Why one, again.',
          units: ['u1', 'u3'],
        },
        { title: 'Second change, drop the old file', description: 'Why two.', units: ['u2', 'u4'] },
      ],
      identity,
    )
    await expect(opened.publish(recut, [])).rejects.toThrow()
    await opened.publish(recut, layers)
    expect(
      (await git(['rev-parse', 'refs/heads/feature-1-first-change-and-the-new-file'])).trim(),
    ).toBe(recut[0]?.sha)
  })

  it('names branches beside the PR branch from the layer title', () => {
    expect(branchName('me/cal-123', 2, 'Room lifecycle: open & close!')).toBe(
      'me/cal-123-2-room-lifecycle-open-close',
    )
    expect(branchName('feature', 1, '!!!')).toBe('feature-1')
  })
})
