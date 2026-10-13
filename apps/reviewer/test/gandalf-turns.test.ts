import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewerStore } from '../server/adapters/store'
import { GandalfJobs } from '../server/features/gandalf/gandalfJobs'
import { GANDALF_PROVIDER_TIMEOUT_MS } from '../server/limits'
import type { GandalfTurn } from '../shared/domain/gandalf'
import { Provider, type PullRequest } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const approval: GandalfTurn = {
  summary: 'No issues found.',
  approved: true,
  issues: [],
  edits: [],
  selections: [],
}
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

function conflictWorkspace(directory: string) {
  return (pull: PullRequest) =>
    Promise.resolve({
      directory,
      pull,
      needsUpdate: true,
      conflicts: ['code.ts'],
      verify: () => Promise.resolve(),
      inspect: () => Promise.resolve({ revision: 'merged', diff: '', conflicts: [] }),
      apply: () => Promise.resolve(),
      publish: () => Promise.resolve('resolved-sha'),
      close: () => Promise.resolve(),
    })
}

describe('Gandalf model turns', () => {
  it('runs each turn as a structured turn in the conflict workspace with its own timeout', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gandalf-turns-'))
    const store = new ReviewerStore({ dataDirectory: directory })
    cleanup.push(() => {
      rmSync(directory, { recursive: true, force: true })
    })
    cleanup.push(() => {
      store.close()
    })
    store.savePreferences({ organization: primary, companion })
    const { turns, requests } = recordingTurns(() => approval)
    const jobs = new GandalfJobs({
      store,
      turns,
      loadPull: vi.fn(() => Promise.resolve(fixturePull())),
      openWorkspace: conflictWorkspace(directory),
    })
    cleanup.push(() => jobs.close())

    const session = jobs.start('review-room/example', [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const turn = (role: string, model: typeof primary) => ({
      model,
      directory,
      timeoutMs: GANDALF_PROVIDER_TIMEOUT_MS,
      purpose: `Gandalf ${role} · review-room/example#128`,
    })
    expect(
      requests.map(({ model, directory, timeoutMs, purpose }) => ({
        model,
        directory,
        timeoutMs,
        purpose,
      })),
    ).toEqual([turn('primary', primary), turn('secondary', companion), turn('primary', primary)])
    expect(requests[0]?.prompt).toContain('do not modify files or run commands')
  })
})
