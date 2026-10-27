import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, vi } from 'vitest'
import { hardenedGit } from '../../server/adapters/git'
import {
  openConflictWorkspace,
  type ConflictWorkspace,
} from '../../server/adapters/conflictWorkspace'
import type { GitHub } from '../../server/adapters/github'
import { fixturePull } from './pull'

/**
 * A local remote whose `feature` and `main` branches both changed `code.ts` since `Initial`, so
 * merging them conflicts, and a GitHub fake that reports the PR from those branches. Each test
 * gets a fresh remote; workspaces it opens with `open` are closed afterwards.
 */
export function conflictRemote() {
  const state = { directory: '', remote: '', head: '', base: '' }
  let workspace: ConflictWorkspace | undefined
  const rest = vi.fn<GitHub['rest']>()
  const github: GitHub = { rest, paginate: vi.fn(), graphql: vi.fn() }
  const git = (args: string[]) => hardenedGit(state.remote, args)
  async function commit(content: string, message: string) {
    await writeFile(join(state.remote, 'code.ts'), content)
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
  async function readRemote(endpoint: string) {
    if (endpoint.includes('/git/ref/heads/')) {
      const branch = decodeURIComponent(endpoint.slice(endpoint.lastIndexOf('/heads/') + 7))
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
    const repo = { full_name: 'review-room/example' }
    return {
      state: 'open',
      head: { sha: state.head, ref: 'feature', repo },
      base: { sha: state.base, ref: 'main', repo },
    }
  }
  beforeEach(async () => {
    state.directory = await mkdtemp(join(tmpdir(), 'gandalf-git-'))
    state.remote = join(state.directory, 'remote')
    await hardenedGit(state.directory, [
      'init',
      '--template=',
      '--initial-branch=main',
      state.remote,
    ])
    await commit('export const value = "original"\n', 'Initial')
    await git(['checkout', '-qb', 'feature'])
    state.head = await commit('export const value = "head"\n', 'Feature')
    await git(['checkout', '-q', 'main'])
    state.base = await commit('export const value = "base"\n', 'Base')
    rest.mockReset().mockImplementation(readRemote)
  })
  afterEach(async () => {
    await workspace?.close()
    workspace = undefined
    await rm(state.directory, { recursive: true, force: true })
  })
  async function open() {
    workspace = await openConflictWorkspace({
      dataDirectory: state.directory,
      pull: { ...fixturePull(), headBranch: 'feature', headSha: state.head, baseSha: state.base },
      github,
      signal: new AbortController().signal,
      remoteUrl: () => state.remote,
    })
    return workspace
  }
  return { state, git, open }
}
