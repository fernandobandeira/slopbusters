import { mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hardenedGit } from '../server/adapters/git'
import { openConflictWorkspace, type ConflictWorkspace } from '../server/adapters/conflictWorkspace'
import { BaseAdvancedError } from '../server/adapters/conflictRevision'
import type { GitIdentity } from '../server/adapters/gitIdentity'
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
    base: { sha: originalBase, ref: 'main', repo: { full_name: 'review-room/example' } },
  }
}
async function open() {
  workspace = await openConflictWorkspace({
    dataDirectory: directory,
    pull: { ...fixturePull(), headBranch: 'feature', headSha: originalHead, baseSha: originalBase },
    github,
    signal: new AbortController().signal,
    remoteUrl: () => remote,
  })
  return workspace
}
async function readRemote(endpoint: string) {
  if (endpoint.includes('/git/ref/heads/')) {
    const branch = decodeURIComponent(
      endpoint.slice(endpoint.indexOf('/git/ref/heads/') + '/git/ref/heads/'.length),
    )
    return { object: { sha: (await git(['rev-parse', `refs/heads/${branch}`])).trim() } }
  }
  const comparison = /\/compare\/(\w+)\.\.\.(\w+)/.exec(endpoint)
  if (comparison) {
    const [, previous = '', next = ''] = comparison
    const contained = await git(['merge-base', '--is-ancestor', previous, next]).then(
      () => true,
      () => false,
    )
    return { status: previous === next ? 'identical' : contained ? 'ahead' : 'diverged' }
  }
  return metadata()
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
  rest.mockReset().mockImplementation(readRemote)
})
afterEach(async () => {
  await workspace?.close()
  workspace = undefined
  await rm(directory, { recursive: true, force: true })
})

describe('live conflict revisions', () => {
  it('uses live branch tips when the PR base SHA still points to an already integrated commit', async () => {
    const staleBase = (await git(['merge-base', originalHead, originalBase])).trim()
    const currentMetadata = metadata()
    rest.mockImplementation((endpoint) =>
      endpoint.includes('/git/ref/heads/')
        ? readRemote(endpoint)
        : Promise.resolve({
            ...currentMetadata,
            base: { ...currentMetadata.base, sha: staleBase },
          }),
    )
    workspace = await openConflictWorkspace({
      dataDirectory: directory,
      pull: { ...fixturePull(), headBranch: 'feature', headSha: originalHead, baseSha: staleBase },
      github,
      signal: new AbortController().signal,
      remoteUrl: () => remote,
    })
    expect(workspace.pull.baseSha).toBe(originalBase)
    expect(workspace.needsUpdate).toBe(true)
    expect(workspace.conflicts).toEqual(['code.ts'])
  })
})

describe('stack update propagation', () => {
  it('propagates a resolved parent through a clean child merge while retaining the child changes', async () => {
    await git(['checkout', '-qb', 'child', originalHead])
    await writeFile(join(remote, 'child.ts'), 'export const child = true\n')
    await git(['add', 'child.ts'])
    const childHead = await commit('export const value = "head"\n', 'Child')
    await git(['checkout', '-q', 'main'])
    const parent = await open()
    await parent.apply([{ path: 'code.ts', content: 'export const value = "head-and-base"\n' }])
    const resolvedParent = await parent.publish()
    await parent.close()
    rest.mockImplementation((endpoint) =>
      endpoint.includes('/git/ref/heads/')
        ? readRemote(endpoint)
        : Promise.resolve({
            state: 'open',
            head: { sha: childHead, ref: 'child', repo: { full_name: 'review-room/example' } },
            base: { sha: originalHead, ref: 'feature', repo: { full_name: 'review-room/example' } },
          }),
    )
    workspace = await openConflictWorkspace({
      dataDirectory: directory,
      pull: {
        ...fixturePull(),
        headBranch: 'child',
        baseBranch: 'feature',
        headSha: childHead,
        baseSha: originalHead,
      },
      github,
      signal: new AbortController().signal,
      remoteUrl: () => remote,
    })
    expect(workspace.conflicts).toEqual([])
    expect(workspace.needsUpdate).toBe(true)
    expect(workspace.pull.baseSha).toBe(resolvedParent)
    await workspace.apply([])
    const resolvedChild = await workspace.publish()
    expect(await git(['show', `${resolvedChild}:code.ts`])).toContain('head-and-base')
    expect(await git(['show', `${resolvedChild}:child.ts`])).toContain('child = true')
    expect((await git(['merge-base', resolvedChild, originalBase])).trim()).toBe(originalBase)
    await workspace.verify(resolvedChild)
  })
  it('recognizes an integrated live base without creating another update', async () => {
    originalBase = originalHead
    await git(['update-ref', 'refs/heads/main', originalBase])
    const work = await open()
    expect(work.conflicts).toEqual([])
    expect(work.needsUpdate).toBe(false)
    await work.verify()
  })
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
  it('rejects a rewritten base before publication', async () => {
    const work = await open()
    await work.apply([{ path: 'code.ts', content: 'resolved\n' }])
    await git(['reset', '-q', '--hard', `${originalBase}^`])
    await commit('rewritten base\n', 'Rewritten base')
    await expect(work.publish()).rejects.toThrow('changed during conflict resolution')
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(originalHead)
  })
  it('publishes against a base that only gained commits and asks for a recheck afterwards', async () => {
    const work = await open()
    await work.apply([{ path: 'code.ts', content: 'resolved\n' }])
    await commit('new base\n', 'Concurrent base')
    const resolved = await work.publish()
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(resolved)
    expect((await git(['show', '-s', '--format=%P', resolved])).trim()).toBe(
      `${originalHead} ${originalBase}`,
    )
    await expect(work.verify(resolved)).rejects.toThrow(BaseAdvancedError)
  })
  it('refuses to overwrite a concurrently updated PR head even if PR metadata is stale', async () => {
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

describe('CI fixes', () => {
  async function openCi(identity?: GitIdentity) {
    workspace = await openConflictWorkspace({
      dataDirectory: directory,
      pull: {
        ...fixturePull(),
        headBranch: 'feature',
        headSha: originalHead,
        baseSha: originalBase,
      },
      github,
      signal: new AbortController().signal,
      task: 'ci',
      identity: identity && (() => Promise.resolve(identity)),
      remoteUrl: () => remote,
    })
    return workspace
  }
  beforeEach(async () => {
    originalBase = originalHead
    await git(['update-ref', 'refs/heads/main', originalBase])
  })
  it('commits fixes and new files directly on the PR head when the base needs no update', async () => {
    const work = await openCi()
    expect(work.needsUpdate).toBe(false)
    await work.apply([
      { path: 'code.ts', content: 'export const value = "fixed"\n' },
      { path: 'test/fixtures/new.ts', content: 'export const fixture = true\n' },
    ])
    const fixed = await work.publish()
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(fixed)
    expect((await git(['show', '-s', '--format=%P%n%s', fixed])).trim()).toBe(
      `${originalHead}\nFix CI for PR #${String(fixturePull().number)}`,
    )
    expect(await git(['show', `${fixed}:test/fixtures/new.ts`])).toBe(
      'export const fixture = true\n',
    )
  })
  it("authors the published commit with the user's identity", async () => {
    const work = await openCi({ name: 'Fernando Bandeira', email: 'fernando@example.com' })
    await work.apply([{ path: 'code.ts', content: 'export const value = "fixed"\n' }])
    const fixed = await work.publish()
    expect((await git(['show', '-s', '--format=%an <%ae>%n%cn <%ce>', fixed])).trim()).toBe(
      'Fernando Bandeira <fernando@example.com>\nFernando Bandeira <fernando@example.com>',
    )
  })
  it('pushes nothing when the models leave the head unchanged', async () => {
    const work = await openCi()
    await work.apply([])
    expect(await work.publish()).toBe(originalHead)
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(originalHead)
  })
  it('refuses CI configuration, Git metadata, deleting missing files and paths beneath files', async () => {
    const work = await openCi()
    await expect(
      work.apply([{ path: '.github/workflows/ci.yml', content: 'on: push\n' }]),
    ).rejects.toThrow('CI configuration')
    await expect(work.apply([{ path: '.git/config', content: 'bad' }])).rejects.toThrow(
      'unsupported file',
    )
    await expect(work.apply([{ path: 'code.ts/inner.ts', content: 'bad' }])).rejects.toThrow(
      'unsupported file',
    )
    await expect(work.apply([{ path: 'missing.ts', content: null }])).rejects.toThrow(
      'does not exist',
    )
    expect((await git(['rev-parse', 'feature'])).trim()).toBe(originalHead)
  })
})

async function fileTypeConflict() {
  await git(['checkout', '-q', 'feature'])
  await writeFile(join(remote, 'CONTEXT.md'), 'Head documentation\n')
  await git(['add', 'CONTEXT.md'])
  originalHead = await commit('export const value = "head"\n', 'Head documentation')
  await git(['checkout', '-q', 'main'])
  await writeFile(join(remote, 'CONTEXT.md'), 'code.ts')
  const blob = (await git(['hash-object', '-w', 'CONTEXT.md'])).trim()
  await git(['update-index', '--add', '--cacheinfo', `120000,${blob},CONTEXT.md`])
  originalBase = await commit('export const value = "base"\n', 'Base symlink')
  return open()
}

describe('file versus symlink conflicts', () => {
  it.each(['head', 'base'] as const)(
    'preserves the %s side and Git file type without creating a filesystem symlink',
    async (side) => {
      const work = await fileTypeConflict()
      const conflict = (await work.inspect()).conflicts.find((file) => file.path === 'CONTEXT.md')
      expect(conflict?.choices).toEqual([
        { side: 'base', type: 'symlink', content: 'code.ts' },
        { side: 'head', type: 'file', content: 'Head documentation\n' },
      ])
      const edits = work.conflicts
        .filter((path) => path !== 'CONTEXT.md')
        .map((path) => ({ path, content: path === 'code.ts' ? 'resolved\n' : null }))
      await work.apply(edits, [{ path: 'CONTEXT.md', side }])
      expect((await lstat(join(work.directory, 'CONTEXT.md'))).isSymbolicLink()).toBe(false)
      const index = await hardenedGit(work.directory, ['ls-files', '--stage', 'CONTEXT.md'])
      expect(index.startsWith(side === 'head' ? '100644' : '120000')).toBe(true)
      expect(await readFile(join(work.directory, 'code.ts'), 'utf8')).toBe('resolved\n')
      const resolved = await work.publish()
      expect(await git(['show', `${resolved}:CONTEXT.md`])).toBe(
        side === 'head' ? 'Head documentation\n' : 'code.ts',
      )
    },
  )
  it('shows settled conflicts to the reviewer and accepts repeating their resolution', async () => {
    const work = await fileTypeConflict()
    const companions = work.conflicts.filter((path) => !['CONTEXT.md', 'code.ts'].includes(path))
    expect(companions).not.toEqual([])
    const states = async () =>
      Object.fromEntries((await work.inspect()).conflicts.map((file) => [file.path, file.state]))
    expect(Object.values(await states())).toEqual(work.conflicts.map(() => 'unresolved'))
    await work.apply(
      [
        { path: 'code.ts', content: 'resolved\n' },
        ...companions.map((path) => ({ path, content: null })),
      ],
      [{ path: 'CONTEXT.md', side: 'base' }],
    )
    expect(await states()).toEqual({
      'code.ts': 'resolved',
      'CONTEXT.md': 'resolved',
      ...Object.fromEntries(companions.map((path) => [path, 'deleted'])),
    })
    // The secondary repeats the deletion as a selection, as Claude did for CONTEXT.md~HEAD.
    await work.apply(
      [],
      [
        { path: 'CONTEXT.md', side: 'base' },
        ...companions.map((path) => ({ path, side: 'delete' as const })),
      ],
    )
    const resolved = await work.publish()
    expect(await git(['ls-tree', '--name-only', resolved])).toBe('CONTEXT.md\ncode.ts\n')
  })
  it('rejects invented and traversing selections and permits reviewed deletion', async () => {
    const work = await fileTypeConflict()
    for (const path of ['../escape', '.git/config', 'code.ts'])
      await expect(work.apply([], [{ path, side: 'base' }])).rejects.toThrow(
        'Unsupported file-type selection',
      )
    const edits = work.conflicts
      .filter((path) => path !== 'CONTEXT.md')
      .map((path) => ({ path, content: path === 'code.ts' ? 'resolved\n' : null }))
    await work.apply(edits, [{ path: 'CONTEXT.md', side: 'delete' }])
    expect(await hardenedGit(work.directory, ['ls-files', 'CONTEXT.md'])).toBe('')
  })
})
