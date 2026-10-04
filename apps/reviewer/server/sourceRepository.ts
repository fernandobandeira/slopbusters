import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { runCommand } from './process'

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

const name = z.string().max(100).regex(/^[\w.-]+$/)
  .refine((value) => value !== '.' && value !== '..')
const commit = z.string().regex(/^[a-f\d]{40}(?:[a-f\d]{24})?$/i)

/** Bare, shallow snapshots share objects across PRs without checking out or running repository files. */
export class LocalSourceRepository {
  private readonly controller = new AbortController()
  private readonly repositories = new Map<string, Promise<void>>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly pending = new Map<string, Promise<GitTree>>()
  private readonly trees = new Map<string, GitTree>()

  constructor(
    private readonly dataDirectory: string,
    private readonly remoteUrl = (owner: string, repo: string) => `https://github.com/${owner}/${repo}.git`,
  ) {}

  private identity(owner: string, repo: string, sha: string) {
    name.parse(owner)
    name.parse(repo)
    commit.parse(sha)
    if (this.controller.signal.aborted) throw new Error('Source navigation is shutting down.')
    const directory = join(this.dataDirectory, 'source-repositories', owner, `${repo}.git`)
    return { directory, key: JSON.stringify([owner, repo, sha]) }
  }

  private git(directory: string, args: string[], maxOutputBytes = 16 * 1024 * 1024) {
    return runCommand({
      command: 'git',
      args: ['-c', `core.hooksPath=${join(directory, 'disabled-hooks')}`, '--git-dir', directory, ...args],
      signal: this.controller.signal,
      timeoutMs: 120_000,
      maxOutputBytes,
      env: { GIT_TERMINAL_PROMPT: '0' },
    })
  }

  private initialize(directory: string): Promise<void> {
    let ready = this.repositories.get(directory)
    if (!ready) {
      ready = (async () => {
        await mkdir(directory, { recursive: true })
        await this.git(directory, ['init', '--bare', '--template=', '--initial-branch=review', directory])
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
    const next = previous.catch(() => {}).then(async () => {
      await this.initialize(directory)
      const ref = `refs/review/${sha}`
      try {
        const saved = await this.git(directory, ['rev-parse', '--verify', ref], 1024)
        if (saved.trim() === sha) return
      } catch {
        if (this.controller.signal.aborted) throw new Error('Source navigation is shutting down.')
      }
      await this.git(directory, [
        '-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
        '-c', 'gc.auto=0', '-c', 'maintenance.auto=false',
        'fetch', '--quiet', '--depth=1', '--no-tags', '--no-recurse-submodules',
        '--no-write-fetch-head', this.remoteUrl(owner, repo), `${sha}:${ref}`,
      ], 4096)
    })
    this.queues.set(directory, next)
    try { await next }
    finally { if (this.queues.get(directory) === next) this.queues.delete(directory) }
  }

  tree(owner: string, repo: string, sha: string): Promise<GitTree> {
    const { directory, key } = this.identity(owner, repo, sha)
    const cached = this.trees.get(key)
    if (cached) return Promise.resolve(cached)
    const active = this.pending.get(key)
    if (active) return active
    const loading = (async () => {
      await this.fetch(directory, owner, repo, sha)
      const output = await this.git(directory, ['ls-tree', '-r', '-z', '-l', sha])
      const tree = output.split('\0').filter(Boolean).map((entry): GitEntry => {
        const match = /^(\d+) (\w+) ([a-f\d]+) +(\d+|-)\t([\s\S]+)$/.exec(entry)
        if (!match) throw new Error('Could not read the local source tree.')
        return { mode: match[1], type: match[2], oid: match[3], size: match[4] === '-' ? 0 : Number(match[4]), path: match[5] }
      })
      const value: GitTree = { truncated: false, tree }
      this.trees.set(key, value)
      if (this.trees.size > 20) this.trees.delete(this.trees.keys().next().value!)
      return value
    })().finally(() => this.pending.delete(key))
    this.pending.set(key, loading)
    return loading
  }

  async file(owner: string, repo: string, sha: string, path: string) {
    const { directory } = this.identity(owner, repo, sha)
    const entry = (await this.tree(owner, repo, sha)).tree.find((entry) => entry.path === path)
    if (!entry || entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))
      throw new Error('This path is not an available regular file in the saved source revision.')
    if (entry.size > 512 * 1024)
      throw new Error(`Context expansion supports files up to 512 KiB: ${path}.`)
    const text = await this.git(directory, ['cat-file', 'blob', entry.oid], 512 * 1024)
    return { __typename: 'Blob' as const, byteSize: entry.size, isBinary: text.includes('\0'), isTruncated: false, text }
  }

  async close() {
    this.controller.abort()
    await Promise.allSettled([...this.pending.values()])
  }
}

export type SourceRepository = Pick<LocalSourceRepository, 'tree' | 'file'>
