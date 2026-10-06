import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { AgentSessionStore } from '../server/adapters/agentSessionStore'
import { ReviewerStore } from '../server/adapters/store'
import { AgentSessions } from '../server/features/agent-sessions/agentSessions'
import { GandalfJobs } from '../server/features/gandalf/gandalfJobs'
import type { GandalfTurn } from '../shared/domain/gandalf'
import { Provider, type PullRequest } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

const clean: GandalfTurn = {
  summary: 'Reviewed',
  approved: true,
  issues: [],
  edits: [],
  selections: [],
}

it('records the preparation phase and private cause when no model pass could start', async () => {
  const fixture = recoveryFixture()
  const { jobs, openWorkspace, traces, directory, urls } = fixture
  try {
    openWorkspace.mockRejectedValueOnce(new Error('private checkout failure'))
    const started = jobs.start('review-room/example', urls)
    await vi.waitFor(() => {
      expect(jobs.get(started.id).status).toBe('failed')
    })
    const saved = jobs.get(started.id)
    expect(saved.failureContext).toBe('Preparing conflicts for PR #1…')
    expect(traces.getSession(started.id)).toMatchObject({
      status: 'failed',
      failureContext: saved.failureContext,
      runs: [],
    })
    expect(
      readFileSync(join(directory, 'agent-diagnostics', `${started.id}.log`), 'utf8'),
    ).toContain('private checkout failure')
  } finally {
    await fixture.close()
  }
})

it('resumes a stack after sleep, retaining transcripts and avoiding duplicate published updates', async () => {
  const fixture = recoveryFixture()
  const { jobs, traces, resolve, publish, urls, plan } = fixture
  try {
    resolve
      .mockResolvedValueOnce(clean)
      .mockResolvedValueOnce(clean)
      .mockResolvedValueOnce(clean)
      .mockImplementationOnce(
        ({ signal, observer }) =>
          new Promise((_done, reject) => {
            observer?.({
              id: 'before-sleep',
              kind: 'assistant',
              text: 'Inspecting the child layer',
            })
            signal.addEventListener(
              'abort',
              () => {
                reject(new Error('Interrupted'))
              },
              { once: true },
            )
          }),
      )
    const session = jobs.start('review-room/example', urls)
    await vi.waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(4)
    })
    expect(jobs.get(session.id).results).toHaveLength(1)
    await jobs.suspend()
    expect(traces.getSession(session.id).runs.map((run) => run.status)).toEqual([
      'complete',
      'complete',
      'complete',
      'cancelled',
    ])
    expect(traces.getSession(session.id).status).toBe('running')
    await jobs.resume()
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    expect(publish.mock.calls.map(([pull]) => pull.number)).toEqual([1, 2])
    expect(plan).toHaveBeenCalledTimes(2)
    expect(jobs.get(session.id).results.map((result) => result.published)).toEqual([true, true])
    const saved = traces.getSession(session.id)
    expect(saved.runs.map((run) => run.status)).toEqual([
      'complete',
      'complete',
      'complete',
      'cancelled',
      'complete',
      'complete',
      'complete',
    ])
    const interrupted = saved.runs[3]
    expect(interrupted).toBeDefined()
    if (interrupted)
      expect(traces.events(session.id, interrupted.id, 0).events[0]?.text).toBe(
        'Inspecting the child layer',
      )
    expect(resolve.mock.calls[4]?.[0].pull.baseSha).toBe('resolved-1')
  } finally {
    await fixture.close()
  }
})

it('keeps cancellation permanent when the user cancels while sleep cleanup is still running', async () => {
  const fixture = recoveryFixture()
  const { jobs, resolve, publish, urls, traces } = fixture
  try {
    resolve.mockImplementationOnce(
      ({ signal }) =>
        new Promise((_done, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(() => {
                reject(new Error('Interrupted'))
              }, 20)
            },
            { once: true },
          )
        }),
    )
    const session = jobs.start('review-room/example', urls)
    await vi.waitFor(() => {
      expect(resolve).toHaveBeenCalledTimes(1)
    })
    const pausing = jobs.suspend()
    jobs.cancel(session.id)
    await Promise.all([pausing, jobs.resume()])
    expect(jobs.get(session.id).status).toBe('cancelled')
    expect(traces.getSession(session.id).status).toBe('cancelled')
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(publish).not.toHaveBeenCalled()
  } finally {
    await fixture.close()
  }
})

function recoveryFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'gandalf-recovery-'))
  const store = new ReviewerStore({ dataDirectory: directory })
  store.savePreferences({ organization: { provider: Provider.codex, model: 'gpt-6.1-sol' } })
  const traces = new AgentSessionStore(directory)
  const pulls = [1, 2].map((number) => ({
    ...fixturePull(),
    number,
    url: fixturePull().url.replace(/\d+$/, String(number)),
  }))
  const urls = pulls.map((pull) => pull.url)
  const published = new Map<string, string>()
  const publish = vi.fn((pull: PullRequest) => {
    const sha = `resolved-${pull.number}`
    published.set(pull.url, sha)
    return Promise.resolve(sha)
  })
  const resolve = vi
    .fn<NonNullable<ConstructorParameters<typeof GandalfJobs>[0]['resolve']>>()
    .mockResolvedValue(clean)
  const plan = vi.fn(() => Promise.resolve(urls))
  const openWorkspace = vi.fn((pull: PullRequest) =>
    Promise.resolve({
      directory,
      pull,
      needsUpdate: !published.has(pull.url),
      conflicts: [],
      inspect: () => Promise.resolve({ revision: 'revision', diff: '', conflicts: [] }),
      apply: () => Promise.resolve(),
      verify: () => Promise.resolve(),
      publish: () => publish(pull),
      close: () => Promise.resolve(),
    }),
  )
  const jobs = new GandalfJobs({
    store,
    sessions: new AgentSessions(traces),
    resolve,
    plan,
    loadPull: (url) => {
      const pull = pulls.find((pull) => pull.url === url)
      if (!pull) throw new Error('Missing fixture PR')
      return Promise.resolve({
        ...pull,
        headSha: published.get(url) ?? pull.headSha,
        baseSha: pull.number === 2 ? (published.get(urls[0] ?? '') ?? pull.baseSha) : pull.baseSha,
      })
    },
    openWorkspace,
  })
  return {
    jobs,
    traces,
    resolve,
    publish,
    urls,
    plan,
    openWorkspace,
    directory,
    async close() {
      await jobs.close()
      traces.close()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
