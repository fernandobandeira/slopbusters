import { mkdir, mkdtemp, readdir, realpath, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { PullRequest } from '../shared/types'
import type { LocalReviewCheckout, ReviewWorkspaceInfo } from '../shared/workspace'
import { runCommand } from './process'
import { validateSourceIdentity, type LocalSourceRepository } from './sourceRepository'
import { workspacePath } from './sourceWorkspace'

export interface ReviewWorkspace {
  directory: string
  sha: string
  paths: Set<string>
  warnings: string[]
}

export interface WorkspaceLease {
  workspace: ReviewWorkspace
  release: () => void
}

/** Each revision owns its Git metadata and objects; no user's clone is modified. */
export class ReviewWorkspaces {
  private readonly controller = new AbortController()
  private readonly pending = new Map<string, Promise<ReviewWorkspace>>()
  private readonly states = new Map<string, ReviewWorkspaceInfo>()
  private readonly users = new Map<string, number>()
  private readonly removals = new Map<string, Promise<void>>()

  constructor(
    private readonly dataDirectory: string,
    private readonly repository: LocalSourceRepository,
  ) {}

  private key(pull: Pick<PullRequest, 'owner' | 'repo'>, sha: string) {
    validateSourceIdentity(pull.owner, pull.repo, sha)
    return JSON.stringify([pull.owner, pull.repo, sha])
  }

  async list(): Promise<LocalReviewCheckout[]> {
    const root = join(this.dataDirectory, 'review-workspaces')
    const directories = async (path: string) => {
      try {
        return (await readdir(path, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
        throw error
      }
    }
    const result: LocalReviewCheckout[] = []
    for (const owner of await directories(root))
      for (const repo of await directories(join(root, owner))) {
        for (const sha of await directories(join(root, owner, repo))) {
          try {
            validateSourceIdentity(owner, repo, sha)
          } catch {
            continue
          }
          const directory = join(root, owner, repo, sha)
          const state = this.states.get(this.key({ owner, repo }, sha))
          result.push({
            owner,
            repo,
            sha,
            directory,
            status: state?.status ?? 'ready',
            warnings: state?.warnings ?? [],
            error: state?.error,
          })
        }
      }
    return result
  }

  status(pull: PullRequest, sha: string): ReviewWorkspaceInfo {
    return this.states.get(this.key(pull, sha)) ?? { sha, status: 'absent', warnings: [] }
  }

  private git(directory: string, args: string[], maxOutputBytes = 4096) {
    return runCommand({
      command: 'git',
      args: [
        '-c',
        `core.hooksPath=${join(this.dataDirectory, 'disabled-hooks')}`,
        '-c',
        'core.symlinks=false',
        '-c',
        'core.autocrlf=false',
        '-C',
        directory,
        ...args,
      ],
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_LFS_SKIP_SMUDGE: '1',
      },
      signal: this.controller.signal,
      timeoutMs: 120_000,
      maxOutputBytes,
    })
  }

  private async verify(directory: string, sha: string) {
    const head = await this.git(directory, ['rev-parse', '--verify', 'HEAD'])
    if (head.trim() !== sha)
      throw new Error(
        'The local review checkout has a different commit. Its files have been preserved.',
      )
    const changes = await this.git(
      directory,
      ['status', '--porcelain', '--untracked-files=all'],
      1024 * 1024,
    )
    if (changes.trim())
      throw new Error(
        'The local review checkout has changes. Its files have been preserved; remove or save them before retrying.',
      )
  }

  private async prepare(pull: PullRequest, sha: string): Promise<ReviewWorkspace> {
    this.controller.signal.throwIfAborted()
    const snapshot = await this.repository.snapshot(pull.owner, pull.repo, sha)
    const parent = join(this.dataDirectory, 'review-workspaces', pull.owner, pull.repo)
    const directory = join(parent, sha)
    const paths = new Set(
      snapshot.entries
        .filter((entry) => entry.type === 'blob' && ['100644', '100755'].includes(entry.mode))
        .map((entry) => entry.path),
    )
    const warnings: string[] = []
    if (snapshot.entries.some((entry) => entry.mode === '160000'))
      warnings.push('Submodule contents are not downloaded. Navigation within them is unavailable.')
    if (paths.has('.gitattributes'))
      warnings.push('Git LFS objects and checkout filters are not downloaded or run automatically.')
    await mkdir(parent, { recursive: true })
    try {
      await realpath(directory)
      await this.verify(directory, sha)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      const temporary = await mkdtemp(join(parent, '.preparing-'))
      try {
        // Fetching copies objects without hardlinks or alternates. The
        // finished checkout remains usable if the source cache is removed.
        await this.git(temporary, ['init', '--template=', '--initial-branch=review'])
        await this.git(temporary, [
          'fetch',
          '--quiet',
          '--depth=1',
          '--no-tags',
          '--no-recurse-submodules',
          snapshot.directory,
          sha,
        ])
        await this.git(temporary, ['checkout', '--quiet', '--detach', sha])
        await this.verify(temporary, sha)
        await rename(temporary, directory)
      } catch (failure) {
        await rm(temporary, { recursive: true, force: true })
        throw failure
      }
    }
    for (const path of paths) {
      try {
        workspacePath(directory, path)
      } catch {
        paths.delete(path)
        warnings.push(`This source path cannot be inspected on this platform: ${path}.`)
      }
    }
    return { directory: await realpath(directory), sha, paths, warnings }
  }

  async acquire(pull: PullRequest, sha: string): Promise<WorkspaceLease> {
    this.controller.signal.throwIfAborted()
    const key = this.key(pull, sha)
    const removal = this.removals.get(key)
    if (removal) await removal
    this.controller.signal.throwIfAborted()
    let pending = this.pending.get(key)
    if (!pending) {
      this.states.set(key, { sha, status: 'preparing', warnings: [] })
      pending = this.prepare(pull, sha)
        .then(
          (workspace) => {
            this.states.set(key, {
              sha,
              directory: workspace.directory,
              status: 'ready',
              warnings: workspace.warnings,
            })
            return workspace
          },
          (error: unknown) => {
            this.states.set(key, {
              sha,
              status: 'failed',
              error: error instanceof Error ? error.message : 'Could not prepare local source.',
              warnings: [],
            })
            throw error
          },
        )
        .finally(() => this.pending.delete(key))
      this.pending.set(key, pending)
    }
    const workspace = await pending
    this.controller.signal.throwIfAborted()
    this.users.set(key, (this.users.get(key) ?? 0) + 1)
    let released = false
    return {
      workspace,
      release: () => {
        if (released) return
        released = true
        const count = (this.users.get(key) ?? 1) - 1
        if (count) this.users.set(key, count)
        else this.users.delete(key)
      },
    }
  }

  async remove(pull: Pick<PullRequest, 'owner' | 'repo'>, sha: string) {
    const key = this.key(pull, sha)
    if (this.pending.has(key) || this.users.has(key))
      throw new Error(
        'This checkout is in use. Close its source viewer and finish its agent review first.',
      )
    const previous = this.removals.get(key)
    if (previous) return previous
    const removing = (async () => {
      // Independent clones can be removed without the source cache or network.
      const directory = join(this.dataDirectory, 'review-workspaces', pull.owner, pull.repo, sha)
      await this.verify(directory, sha)
      await rm(directory, { recursive: true })
      this.repository.forget(pull.owner, pull.repo, sha)
      this.states.delete(key)
    })().finally(() => this.removals.delete(key))
    this.removals.set(key, removing)
    return removing
  }

  async close() {
    this.controller.abort()
    await Promise.allSettled([...this.pending.values(), ...this.removals.values()])
  }
}
