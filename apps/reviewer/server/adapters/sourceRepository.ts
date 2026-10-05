import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { createCache } from '../cache'
import { UserError } from '../errors'
import { hardenedGit } from './git'
import { MAX_FILE_BYTES, MAX_GIT_OUTPUT_BYTES } from '../limits'

interface GitEntry {
  path: string
  mode: string
  type: string
  oid: string
  size: number
}
interface GitTree {
  truncated: false
  tree: GitEntry[]
}

const name = z
  .string()
  .max(100)
  .regex(/^[\w.-]+$/)
  .refine((value) => value !== '.' && value !== '..')
const commit = z.string().regex(/^[a-f\d]{40}(?:[a-f\d]{24})?$/i)

export function validateSourceIdentity(owner: string, repo: string, sha: string) {
  name.parse(owner)
  name.parse(repo)
  commit.parse(sha)
}

/** Bare, shallow snapshots share objects across PRs without checking out or running repository files. */
export class LocalSourceRepository {
  private readonly controller = new AbortController()
  private readonly repositories = new Map<string, Promise<void>>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly trees = createCache<{ tree: GitTree; directory: string }>({ max: 20 })

  constructor(
    private readonly dataDirectory: string,
    private readonly remoteUrl = (owner: string, repo: string) =>
      `https://github.com/${owner}/${repo}.git`,
  ) {}

  private identity(owner: string, repo: string, sha: string) {
    validateSourceIdentity(owner, repo, sha)
    if (this.controller.signal.aborted) throw new UserError('Source navigation is shutting down.')
    const directory = join(this.dataDirectory, 'source-repositories', owner, `${repo}.git`)
    return { directory, key: JSON.stringify([owner, repo, sha]) }
  }

  private git(directory: string, args: string[], maxOutputBytes = MAX_GIT_OUTPUT_BYTES) {
    return hardenedGit(directory, args, {
      bare: true,
      signal: this.controller.signal,
      maxOutputBytes,
    })
  }

  private initialize(directory: string): Promise<void> {
    let ready = this.repositories.get(directory)
    if (!ready) {
      ready = (async () => {
        await mkdir(directory, { recursive: true })
        await this.git(directory, [
          'init',
          '--bare',
          '--template=',
          '--initial-branch=review',
          directory,
        ])
      })().catch((error) => {
        this.repositories.delete(directory)
        throw error
      })
      this.repositories.set(directory, ready)
    }
    return ready
  }

  private async fetch(directory: string, owner: string, repo: string, sha: string) {
    // Fetches mutate the shared shallow boundary, so serialize them per repository.
    const previous = this.queues.get(directory) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await this.initialize(directory)
        const ref = `refs/review/${sha}`
        try {
          const saved = await this.git(directory, ['rev-parse', '--verify', ref], 1024)
          if (saved.trim() === sha) return
        } catch {
          if (this.controller.signal.aborted)
            throw new UserError('Source navigation is shutting down.')
        }
        await this.git(
          directory,
          [
            '-c',
            'credential.helper=',
            '-c',
            'credential.helper=!gh auth git-credential',
            '-c',
            'gc.auto=0',
            '-c',
            'maintenance.auto=false',
            'fetch',
            '--quiet',
            '--depth=1',
            '--no-tags',
            '--no-recurse-submodules',
            '--no-write-fetch-head',
            this.remoteUrl(owner, repo),
            `${sha}:${ref}`,
          ],
          4096,
        )
      })
    this.queues.set(directory, next)
    try {
      await next
    } finally {
      if (this.queues.get(directory) === next) this.queues.delete(directory)
    }
  }

  private snapshotData(owner: string, repo: string, sha: string) {
    const { directory, key } = this.identity(owner, repo, sha)
    return this.trees.load(key, async () => {
      let sourceDirectory = directory
      try {
        await this.git(directory, ['cat-file', '-e', `${sha}^{commit}`], 1024)
      } catch {
        // Reuse independent objects before attempting a network fetch. A
        // completed review remains available offline even without the cache.
        const checkout = join(this.dataDirectory, 'review-workspaces', owner, repo, sha, '.git')
        try {
          await this.git(checkout, ['cat-file', '-e', `${sha}^{commit}`], 1024)
          sourceDirectory = checkout
        } catch {
          await this.fetch(directory, owner, repo, sha)
        }
      }
      const output = await this.git(sourceDirectory, ['ls-tree', '-r', '-z', '-l', sha])
      const tree = output
        .split('\0')
        .filter(Boolean)
        .map((entry): GitEntry => {
          const match = /^(\d+) (\w+) ([a-f\d]+) +(\d+|-)\t([\s\S]+)$/.exec(entry)
          if (!match) throw new UserError('Could not read the local source tree.')
          return {
            mode: match[1]!,
            type: match[2]!,
            oid: match[3]!,
            size: match[4] === '-' ? 0 : Number(match[4]),
            path: match[5]!,
          }
        })
      const value: GitTree = { truncated: false, tree }
      return { tree: value, directory: sourceDirectory }
    })
  }

  tree(owner: string, repo: string, sha: string): Promise<GitTree> {
    this.identity(owner, repo, sha)
    return this.snapshotData(owner, repo, sha).then((snapshot) => snapshot.tree)
  }

  async file(owner: string, repo: string, sha: string, path: string) {
    const snapshot = await this.snapshotData(owner, repo, sha)
    const entry = snapshot.tree.tree.find((entry) => entry.path === path)
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
      throw new UserError(
        'This path is not an available regular file in the saved source revision.',
      )
    if (entry.size > MAX_FILE_BYTES)
      throw new UserError(`Context expansion supports files up to 512 KiB: ${path}.`)
    const text = await this.git(snapshot.directory, ['cat-file', 'blob', entry.oid], MAX_FILE_BYTES)
    return {
      __typename: 'Blob' as const,
      byteSize: entry.size,
      isBinary: text.includes('\0'),
      isTruncated: false,
      text,
    }
  }

  /** Consumers clone these objects into independent repositories, never linked worktrees. */
  async snapshot(owner: string, repo: string, sha: string) {
    const snapshot = await this.snapshotData(owner, repo, sha)
    return { directory: snapshot.directory, entries: snapshot.tree.tree }
  }

  forget(owner: string, repo: string, sha: string) {
    const { key } = this.identity(owner, repo, sha)
    this.trees.delete(key)
  }

  async close() {
    this.controller.abort()
    await this.trees.settled()
  }
}

export type SourceRepository = Pick<LocalSourceRepository, 'tree' | 'file'>
