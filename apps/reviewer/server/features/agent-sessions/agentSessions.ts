import { randomUUID } from 'node:crypto'
import type { AgentSession, AgentRun, ProviderObserver } from '../../../shared/domain/agentSession'
import type { AgentSessionStore } from '../../adapters/agentSessionStore'
import { logError, publicError, UserError } from '../../errors'

export class AgentSessions {
  constructor(readonly store: AgentSessionStore) {}
  start(
    id: string,
    kind: AgentSession['kind'],
    source: { repository: string; urls: string[]; createdAt?: string },
  ) {
    const now = new Date().toISOString()
    this.store.saveSession({
      id,
      kind,
      ...source,
      status: 'running',
      progress: 'Preparing…',
      createdAt: source.createdAt ?? now,
      updatedAt: now,
    })
  }
  update(source: {
    id: string
    status: AgentSession['status']
    progress: string
    urls?: string[]
    error?: string
    failureContext?: string
  }) {
    const previous = this.store.getSession(source.id)
    this.store.saveSession({ ...previous, ...source, updatedAt: new Date().toISOString() })
  }
  sync(
    kind: AgentSession['kind'],
    source: Pick<
      AgentSession,
      'id' | 'repository' | 'urls' | 'status' | 'progress' | 'createdAt'
    > & { error?: string; failureContext?: string },
  ) {
    try {
      this.store.getSession(source.id)
    } catch (error) {
      if (!(error instanceof UserError) || error.status !== 404) throw error
      this.start(source.id, kind, source)
    }
    this.update(source)
  }
  async run<T>(
    sessionId: string,
    pass: Pick<AgentRun, 'model' | 'label' | 'url'>,
    execute: (observer: ProviderObserver) => Promise<T>,
  ) {
    const run: AgentRun = {
      id: randomUUID(),
      sessionId,
      ...pass,
      status: 'running',
      startedAt: new Date().toISOString(),
    }
    this.store.saveRun(run)
    try {
      const result = await execute((event) => {
        this.store.event(run.id, event)
      })
      this.store.event(run.id, {
        id: 'result',
        kind: 'assistant',
        title: 'Result',
        text: JSON.stringify(result, null, 2),
        status: 'complete',
      })
      this.store.saveRun({
        ...run,
        status: this.store.getSession(sessionId).status === 'cancelled' ? 'cancelled' : 'complete',
        finishedAt: new Date().toISOString(),
      })
      return result
    } catch (cause) {
      const root = this.store.getSession(sessionId)
      this.store.saveRun({
        ...run,
        status: root.status === 'cancelled' ? 'cancelled' : 'failed',
        finishedAt: new Date().toISOString(),
        error: publicError(cause, 'The model pass failed. Please retry.'),
      })
      this.diagnostic(run.id, run.label, cause)
      throw cause
    }
  }
  diagnostic(id: string, context: string, cause: unknown) {
    try {
      this.store.diagnostic(id, context, cause)
    } catch (error) {
      logError('Saving agent diagnostics', error)
    }
  }
}
