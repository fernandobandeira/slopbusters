import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { NavigationRequest, NavigationResult } from '../shared/navigation'
import type { PullRequest } from '../shared/types'
import type { ReviewWorkspaces, WorkspaceLease } from './reviewWorkspaces'
import type { SourceProject } from './sourceWorkspace'

interface Entry {
  worker: Worker
  lease: WorkspaceLease
  users: number
  pending: Map<
    number,
    {
      resolve: (result: NavigationResult) => void
      reject: (error: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >
}
export interface TypeScriptWorkerOptions {
  typeScriptWorkerPath?: string
  typeScriptLibDirectory?: string
}

/** Persistent full-project analysis lives off the Electron main thread. */
export class WorkspaceTypeScriptNavigation {
  private entries = new Map<string, Entry>()
  private sequence = 0
  private closed = false
  constructor(
    private project: SourceProject,
    private workspaces: Pick<ReviewWorkspaces, 'acquire'>,
    private options: TypeScriptWorkerOptions = {},
  ) {}

  private async retire(
    key: string,
    entry: Entry,
    error = new Error('Source analysis has stopped. Retry navigation.'),
  ) {
    if (this.entries.get(key) === entry) this.entries.delete(key)
    for (const pending of entry.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    entry.pending.clear()
    await entry.worker.terminate()
    entry.lease.release()
  }

  async navigate(pull: PullRequest, request: NavigationRequest): Promise<NavigationResult> {
    if (this.closed) throw new Error('Source navigation is shutting down.')
    const tree = await this.project.tree(pull, request.side)
    const key = JSON.stringify([pull.owner, pull.repo, tree.sha])
    let entry = this.entries.get(key)
    if (!entry) {
      const lease = await this.workspaces.acquire(pull, tree.sha)
      if (this.closed) {
        lease.release()
        throw new Error('Source navigation is shutting down.')
      }
      // Another request can finish preparing the same revision while this one waits.
      entry = this.entries.get(key)
      if (entry) lease.release()
      else {
        let worker: Worker
        try {
          worker = (() => {
            let workerPath = this.options.typeScriptWorkerPath
            let libDirectory = this.options.typeScriptLibDirectory
            if (!workerPath || !libDirectory) {
              const require = createRequire(import.meta.url)
              workerPath ??= require.resolve('./workspaceTypeScriptWorker.ts')
              libDirectory ??= dirname(require.resolve('typescript'))
            }
            return new Worker(workerPath, {
              workerData: {
                directory: lease.workspace.directory,
                paths: [...lease.workspace.paths],
                libDirectory,
              },
              execArgv: [],
            })
          })()
        } catch (error) {
          lease.release()
          throw error
        }
        entry = { worker, lease, pending: new Map(), users: 0 }
        const created = entry
        worker.on(
          'message',
          ({ id, result, error }: { id: number; result: NavigationResult; error?: string }) => {
            const pending = created.pending.get(id)
            if (!pending) return
            clearTimeout(pending.timer)
            created.pending.delete(id)
            if (error) pending.reject(new Error(error))
            else
              pending.resolve({
                ...result,
                warnings: [...created.lease.workspace.warnings, ...result.warnings],
                source: { sha: tree.sha, kind: 'local' },
              })
          },
        )
        worker.on('error', (error) => {
          void this.retire(key, created, error instanceof Error ? error : new Error(String(error)))
        })
        worker.on('exit', () => {
          if (this.entries.get(key) === created) void this.retire(key, created)
        })
        this.entries.set(key, entry)
      }
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    entry.users++
    const current = entry
    try {
      return await new Promise<NavigationResult>((resolve, reject) => {
        const id = ++this.sequence
        const timer = setTimeout(() => {
          void this.retire(key, current)
        }, 60_000)
        current.pending.set(id, { resolve, reject, timer })
        current.worker.postMessage({ id, request })
      })
    } finally {
      current.users--
      for (const [candidateKey, candidate] of this.entries) {
        if (this.entries.size <= 3) break
        if (!candidate.users) await this.retire(candidateKey, candidate)
      }
    }
  }

  async close() {
    this.closed = true
    await Promise.all([...this.entries].map(([key, entry]) => this.retire(key, entry)))
  }

  async closeRevision(owner: string, repo: string, sha: string, invalidate = false) {
    const key = JSON.stringify([owner, repo, sha])
    const entry = this.entries.get(key)
    if (!entry) return
    if (entry.users && !invalidate)
      throw new Error(
        'Source analysis is in progress. Try removing this checkout when it finishes.',
      )
    await this.retire(key, entry)
  }
}
