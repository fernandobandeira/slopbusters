import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewerStore } from '../../../../server/adapters/store'
import { GandalfJobs } from '../../../../server/features/gandalf/gandalfJobs'
import { GANDALF_PROVIDER_TIMEOUT_MS } from '../../../../server/features/gandalf/limits'
import { Provider, type PullRequest } from '../../../../shared/domain/types'
import { fixturePull } from '../../../fixtures/pull'
import { recordingTurns } from '../../../fixtures/turns'
import { approvalTurn, idleWorkspaceParts } from '../../../fixtures/gandalf'

const primary = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const companion = { provider: Provider.claude, model: 'claude-opus-5-5' }
const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step()
})

function conflictWorkspace(directory: string, absorb = idleWorkspaceParts.absorb) {
  return (pull: PullRequest) =>
    Promise.resolve({
      directory,
      pull,
      needsUpdate: true,
      conflicts: ['code.ts'],
      verify: () => Promise.resolve(),
      inspect: () => Promise.resolve({ revision: 'merged', conflicts: [] }),
      ...idleWorkspaceParts,
      absorb,
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
    const { turns, requests } = recordingTurns(() => approvalTurn)
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
    expect(requests[0]?.copy).toMatchObject({ git: true, editable: true })
    expect(requests[0]?.prompt).toContain('read-only Git commands')
    expect(requests[0]?.prompt).toContain('editing files in place')
  })
  it('records what Gandalf found still wrong as issues and never approves over it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'gandalf-turns-'))
    const store = new ReviewerStore({ dataDirectory: directory })
    cleanup.push(() => {
      rmSync(directory, { recursive: true, force: true })
    })
    cleanup.push(() => {
      store.close()
    })
    store.savePreferences({ organization: primary, companion })
    const leftover = 'These merge conflicts are still unresolved: code.ts.'
    const absorb = vi
      .fn<typeof idleWorkspaceParts.absorb>()
      .mockResolvedValueOnce({ changedPaths: [], problems: [leftover] })
      .mockResolvedValueOnce({ changedPaths: [], problems: [leftover] })
      .mockResolvedValue({ changedPaths: [], problems: [] })
    const { turns, requests } = recordingTurns(() => approvalTurn)
    const jobs = new GandalfJobs({
      store,
      turns,
      loadPull: vi.fn(() => Promise.resolve(fixturePull())),
      openWorkspace: conflictWorkspace(directory, absorb),
    })
    cleanup.push(() => jobs.close())

    const session = jobs.start('review-room/example', [fixturePull().url])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const saved = jobs.get(session.id)
    expect(requests).toHaveLength(4)
    expect(saved.turns.map((turn) => turn.approved)).toEqual([false, false, true, true])
    expect(saved.turns[1]?.issues).toEqual([`Gandalf: ${leftover}`])
  })
})
