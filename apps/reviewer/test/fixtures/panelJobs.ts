import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach } from 'vitest'
import { InstalledSkills } from '../../server/adapters/installedSkills'
import { ReviewerStore } from '../../server/adapters/store'
import { TeammateStore } from '../../server/adapters/teammateStore'
import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../../server/adapters/t3Engine/engineTurns'
import { PanelJobs } from '../../server/features/panel/panelJobs'
import { PanelMembers } from '../../server/features/panel/panelMembers'
import { Teammates } from '../../server/features/teammates/teammates'
import type { ReviewerId } from '../../shared/domain/panel'
import { Provider } from '../../shared/domain/types'
import { fixtureJudgeAdvice, fixturePanelAdvice } from './panel'
import { fixturePull } from './pull'
import { installSkill, temporarySkillRoots } from './skills'

export const primary = { provider: Provider.claude, model: 'claude-opus-5-5' }
export const companion = { provider: Provider.codex, model: 'gpt-6.1-sol' }
export const repository = 'review-room/example'
export const url = fixturePull().url
export const everyone: ReviewerId[] = ['unclebob', 'terminator', 'teammate:avery']

type Sources = Pick<ConstructorParameters<typeof PanelJobs>[0], 'loadPull' | 'stack' | 'history'>

/**
 * A data directory, skill roots and teammate Avery (Claude only, five findings) for each test,
 * and `panel` to build the jobs under test, closed after it.
 */
export function panelHarness() {
  const harness = {} as {
    data: string
    roots: ReturnType<typeof temporarySkillRoots>
    store: ReviewerStore
    teammates: Teammates
    jobs?: PanelJobs
    panel: (turns: StructuredTurns, sources?: Sources) => PanelJobs
  }
  beforeEach(async () => {
    harness.data = mkdtempSync(join(tmpdir(), 'panel-jobs-'))
    harness.roots = temporarySkillRoots()
    harness.store = new ReviewerStore({ dataDirectory: harness.data })
    harness.teammates = new Teammates(
      new TeammateStore(harness.data),
      new InstalledSkills(harness.roots),
    )
    installSkill(harness.roots.claude, 'AveryReview', { description: 'Review the way Avery does.' })
    await harness.teammates.create({ name: 'Avery', skill: 'AveryReview', maxFindings: 5 })
  })
  afterEach(async () => {
    await harness.jobs?.close()
    harness.jobs = undefined
    harness.store.close()
    rmSync(harness.data, { recursive: true, force: true })
    rmSync(harness.roots.home, { recursive: true, force: true })
  })
  harness.panel = (turns, sources = { loadPull: () => Promise.resolve(fixturePull()) }) => {
    harness.jobs = new PanelJobs({
      store: harness.store.panel,
      turns,
      members: new PanelMembers({
        teammates: harness.teammates,
        builtIn: (id) => Promise.resolve(`The ${id} skill.`),
      }),
      models: () => ({ primary, companion }),
      ...sources,
    })
    return harness.jobs
  }
  return harness
}

export const isJudge = (request: StructuredTurnRequest<unknown>) =>
  Boolean(request.purpose?.startsWith('Panel judge'))

export function reply(request: StructuredTurnRequest<unknown>) {
  return isJudge(request)
    ? fixtureJudgeAdvice(['unclebob', 'teammate:avery'])
    : fixturePanelAdvice()
}
