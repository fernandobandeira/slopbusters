import { randomUUID } from 'node:crypto'
import type { PullRequest } from '../shared/types'
import {
  setupPlanSchema,
  type SetupPlan,
  type SetupRequest,
  type WorkspaceSetup,
} from '../shared/workspaceSetup'
import type { ReviewWorkspaces, WorkspaceLease } from './reviewWorkspaces'
import {
  PreparedEnvironmentStorage,
  assertPreparedSource,
  runSetupCommand,
} from './adapters/preparedEnvironment'
import {
  MAX_PREPARED_ENVIRONMENTS,
  MAX_SETUP_JOBS,
  PREPARED_ENVIRONMENT_IDLE_MS,
  SETUP_LOG_CHARACTERS,
} from './limits'

type Environment = Awaited<ReturnType<PreparedEnvironmentStorage['create']>>
interface Entry {
  view: WorkspaceSetup
  pull: PullRequest
  request: SetupRequest
  controller: AbortController
  task: Promise<void>
  environment?: Environment
  users: number
  lastUsed: number
  removing?: Promise<WorkspaceSetup>
}
export type SetupPlanner = (
  pull: PullRequest,
  sha: string,
  request: SetupRequest,
  signal: AbortSignal,
) => Promise<SetupPlan>
type Invalidate = (owner: string, repo: string, sha: string) => Promise<void>

/** Read-only planning and explicitly approved execution are separate states. */
export class WorkspaceSetups {
  private entries = new Map<string, Entry>()
  private closed = false
  private expiry = setInterval(() => {
    for (const entry of this.entries.values()) {
      if (
        entry.view.status === 'ready' &&
        Date.now() - entry.lastUsed > PREPARED_ENVIRONMENT_IDLE_MS
      )
        void this.remove(entry.view.id).catch(() => {
          /* An active reviewer retains its environment. */
        })
    }
  }, 5 * 60_000).unref()

  constructor(
    private base: Pick<ReviewWorkspaces, 'acquire'>,
    private storage: PreparedEnvironmentStorage,
    private planner: SetupPlanner,
    private invalidate: Invalidate,
  ) {}

  list() {
    return [...this.entries.values()].map((entry) => entry.view)
  }
  private entry(id: string) {
    const entry = this.entries.get(id)
    if (!entry) throw new Error('This workspace setup is no longer available.')
    return entry
  }
  get(id: string) {
    return this.entry(id).view
  }
  touch(pull: PullRequest) {
    for (const entry of this.entries.values())
      if (entry.view.pullId === pull.id) entry.lastUsed = Date.now()
  }

  start(pull: PullRequest, sha: string, request: SetupRequest) {
    if (this.closed) throw new Error('Workspace setup is shutting down.')
    const existing = [...this.entries.values()].find(
      ({ view }) =>
        view.pullId === pull.id &&
        view.sha === sha &&
        !['failed', 'cancelled'].includes(view.status),
    )
    if (existing) return existing.view
    for (const [id, entry] of this.entries) {
      if (this.entries.size < MAX_SETUP_JOBS) break
      if (['failed', 'cancelled'].includes(entry.view.status) && !entry.environment)
        this.entries.delete(id)
    }
    if (this.entries.size >= MAX_SETUP_JOBS)
      throw new Error('Clear an earlier setup before planning another.')
    const view: WorkspaceSetup = {
      id: randomUUID(),
      pullId: pull.id,
      owner: pull.owner,
      repo: pull.repo,
      sha,
      provider: request.provider,
      status: 'planning',
      log: '',
    }
    const entry: Entry = {
      view,
      pull,
      request,
      controller: new AbortController(),
      task: Promise.resolve(),
      users: 0,
      lastUsed: Date.now(),
    }
    this.entries.set(view.id, entry)
    entry.task = this.plan(entry)
    return view
  }

  private async plan(entry: Entry) {
    try {
      const plan = setupPlanSchema.parse(
        await this.planner(entry.pull, entry.view.sha, entry.request, entry.controller.signal),
      )
      entry.controller.signal.throwIfAborted()
      entry.view.plan = plan
      entry.view.status = 'awaiting-approval'
    } catch (error) {
      this.fail(entry, error)
    }
  }

  approve(id: string, pull: PullRequest, sha: string) {
    const entry = this.entry(id)
    if (
      this.closed ||
      entry.view.status !== 'awaiting-approval' ||
      !entry.view.plan?.commands.length
    )
      throw new Error('There is no setup command list awaiting approval.')
    if (entry.view.pullId !== pull.id || entry.view.sha !== sha)
      throw new Error('The PR revision changed. Request a new setup plan for this revision.')
    if (
      [...this.entries.values()].filter(
        (item) => item.environment || item.view.status === 'running',
      ).length >= MAX_PREPARED_ENVIRONMENTS
    )
      throw new Error('Clear a prepared environment before starting another (maximum two).')
    entry.view.status = 'running'
    entry.task = this.execute(entry)
    return entry.view
  }

  private async execute(entry: Entry) {
    try {
      entry.environment = await this.storage.create(entry.pull, entry.view.sha, entry.view.id)
      const { workspace } = entry.environment
      entry.view.directory = workspace.directory
      for (const command of entry.view.plan!.commands) {
        entry.controller.signal.throwIfAborted()
        this.append(
          entry,
          `\n[${command.directory}] ${JSON.stringify([command.command, ...command.args])}\n`,
        )
        await runSetupCommand(workspace, command, entry.controller.signal, (text) =>
          this.append(entry, text),
        )
        await assertPreparedSource(workspace)
      }
      entry.controller.signal.throwIfAborted()
      await this.invalidate(entry.view.owner, entry.view.repo, entry.view.sha)
      entry.controller.signal.throwIfAborted()
      entry.view.status = 'ready'
      entry.lastUsed = Date.now()
      this.append(
        entry,
        '\nSetup finished. Retry navigation. Missing generated or external declarations may still require your configured IDE.\n',
      )
    } catch (error) {
      this.fail(entry, error)
      // The process runner waits for terminated command groups before cleanup.
      try {
        await entry.environment?.dispose()
        entry.environment = undefined
        entry.view.directory = undefined
      } catch (cleanupError) {
        entry.view.error = `${entry.view.error ?? 'Setup was cancelled.'} Could not clear the partial environment: ${cleanupError instanceof Error ? cleanupError.message : 'cleanup failed'}`
      }
    }
  }

  private append(entry: Entry, text: string) {
    entry.view.log = (entry.view.log + text).slice(-SETUP_LOG_CHARACTERS)
  }
  private fail(entry: Entry, error: unknown) {
    entry.view.status = entry.controller.signal.aborted ? 'cancelled' : 'failed'
    entry.view.error = entry.controller.signal.aborted
      ? undefined
      : error instanceof Error
        ? error.message.slice(0, 4000)
        : 'Workspace setup failed. Use your configured IDE instead.'
  }

  async acquire(pull: PullRequest, sha: string): Promise<WorkspaceLease> {
    if (this.closed) throw new Error('Workspace setup is shutting down.')
    const entry = [...this.entries.values()].find(
      ({ view }) =>
        view.owner === pull.owner &&
        view.repo === pull.repo &&
        view.sha === sha &&
        view.status === 'ready',
    )
    if (!entry?.environment) return this.base.acquire(pull, sha)
    entry.users++
    try {
      await assertPreparedSource(entry.environment.workspace)
    } catch (error) {
      entry.users--
      throw error
    }
    entry.lastUsed = Date.now()
    let released = false
    return {
      workspace: {
        ...entry.environment.workspace,
        warnings: [
          ...entry.environment.workspace.warnings,
          'Analysis uses an approved, disposable prepared environment. Dependencies and generated files are not committed PR evidence.',
        ],
      },
      release: () => {
        if (!released) {
          released = true
          entry.users--
          entry.lastUsed = Date.now()
        }
      },
    }
  }

  async remove(id: string) {
    const entry = this.entry(id)
    if (entry.removing) return entry.removing
    entry.removing = this.clear(entry).finally(() => {
      entry.removing = undefined
    })
    return entry.removing
  }
  private async clear(entry: Entry) {
    if (['planning', 'running'].includes(entry.view.status)) {
      entry.controller.abort()
    }
    await entry.task
    if (entry.environment) {
      // Stop new leases before retiring sessions or deleting their files.
      const previous = entry.view.status
      entry.view.status = 'cancelled'
      try {
        await this.invalidate(entry.view.owner, entry.view.repo, entry.view.sha)
        if (entry.users)
          throw new Error(
            'This environment is in use by a review agent. Finish the review before clearing it.',
          )
        await entry.environment.dispose()
        entry.environment = undefined
      } catch (error) {
        entry.view.status = previous
        throw error
      }
    }
    entry.view.status = 'cancelled'
    entry.view.directory = undefined
    return entry.view
  }

  async stop() {
    this.closed = true
    clearInterval(this.expiry)
    for (const entry of this.entries.values()) entry.controller.abort()
    await Promise.all([...this.entries.values()].map((entry) => entry.task))
  }
  async close() {
    await this.stop()
    await Promise.all([...this.entries.values()].map((entry) => entry.environment?.dispose()))
    await this.storage.close()
  }
}
