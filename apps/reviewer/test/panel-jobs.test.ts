import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstalledSkills } from '../server/adapters/installedSkills'
import { ReviewerStore } from '../server/adapters/store'
import { TeammateStore } from '../server/adapters/teammateStore'
import type {
  StructuredTurnRequest,
  StructuredTurns,
} from '../server/adapters/t3Engine/engineTurns'
import { PanelJobs } from '../server/features/panel/panelJobs'
import { PanelMembers } from '../server/features/panel/panelMembers'
import { Teammates } from '../server/features/teammates/teammates'
import type { ReviewerId } from '../shared/domain/panel'
import { Provider } from '../shared/domain/types'
import { fixtureJudgeAdvice, fixturePanelAdvice } from './fixtures/panel'
import { fixturePull } from './fixtures/pull'
import { installSkill, temporarySkillRoots } from './fixtures/skills'
import { recordingTurns } from './fixtures/turns'

const primary = { provider: Provider.claude, model: 'claude-opus-5-5' }
const companion = { provider: Provider.codex, model: 'gpt-6.1-sol' }
const repository = 'review-room/example'
const url = fixturePull().url
let data: string
let roots: ReturnType<typeof temporarySkillRoots>
let store: ReviewerStore
let teammates: Teammates
let jobs: PanelJobs | undefined

beforeEach(async () => {
  data = mkdtempSync(join(tmpdir(), 'panel-jobs-'))
  roots = temporarySkillRoots()
  store = new ReviewerStore({ dataDirectory: data })
  teammates = new Teammates(new TeammateStore(data), new InstalledSkills(roots))
  installSkill(roots.claude, 'AveryReview', { description: 'Review the way Avery does.' })
  await teammates.create({ name: 'Avery', skill: 'AveryReview', maxFindings: 5 })
})
afterEach(async () => {
  await jobs?.close()
  jobs = undefined
  store.close()
  rmSync(data, { recursive: true, force: true })
  rmSync(roots.home, { recursive: true, force: true })
})

function panel(turns: StructuredTurns) {
  jobs = new PanelJobs({
    store: store.panel,
    turns,
    members: new PanelMembers({ teammates, builtIn: (id) => Promise.resolve(`The ${id} skill.`) }),
    models: () => ({ primary, companion }),
    loadPull: () => Promise.resolve(fixturePull()),
  })
  return jobs
}

const isJudge = (request: StructuredTurnRequest<unknown>) =>
  Boolean(request.purpose?.startsWith('Panel judge'))

function reply(request: StructuredTurnRequest<unknown>) {
  return isJudge(request)
    ? fixtureJudgeAdvice(['unclebob', 'teammate:avery'])
    : fixturePanelAdvice()
}

const everyone: ReviewerId[] = ['unclebob', 'rules', 'teammate:avery']

describe('a panel review', () => {
  it('runs each reviewer once on the primary model with its own skill, then the judge', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const reviews = requests.filter((request) => !isJudge(request))
    expect(reviews.map((request) => request.model)).toEqual([primary, primary, primary])
    const avery = reviews.find((request) => request.purpose?.startsWith('Avery'))
    expect(avery?.prompt).toContain('Review carefully.')
    expect(avery?.prompt).toContain('Report at most 5 findings')
    expect(avery?.include).toEqual([
      { directory: expect.stringMatching(/AveryReview$/) as string, as: '.slopbusters/skill' },
    ])
    const judge = requests.find(isJudge)
    expect(judge?.prompt).toContain('- teammate:avery: Avery (Review the way Avery does.)')
    const [result] = jobs.get(session.id).results
    expect(result?.advice.findings[0]?.raisedBy).toEqual(['unclebob', 'teammate:avery'])
    expect(result?.reviews.map((review) => review.reviewer)).toHaveLength(3)
  })

  it('runs at most three reviewers at a time', async () => {
    for (const name of ['Riley', 'Morgan'])
      await teammates.create({
        name,
        skill: installSkill(roots.claude, `${name}Review`).split('/').pop() ?? '',
        maxFindings: 5,
      })
    let running = 0
    let most = 0
    const turns: StructuredTurns = {
      run: async <T>(request: StructuredTurnRequest<T>) => {
        running++
        most = Math.max(most, running)
        await new Promise((resolve) => setTimeout(resolve, 5))
        running--
        return request.schema.parse(reply(request))
      },
    }
    const jobs = panel(turns)

    const session = await jobs.start(
      repository,
      [url],
      [...everyone, 'teammate:riley', 'teammate:morgan'],
    )
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    expect(most).toBe(3)
  })
})

describe('a panel reviewer that fails', () => {
  it('waits on the user when a reviewer fails, then judges with the reviews that finished', async () => {
    const { turns, requests } = recordingTurns((request) => {
      if (request.purpose?.startsWith('Rules')) throw new Error('Rules timed out')
      return reply(request)
    })
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    expect(jobs.get(session.id).progress).toMatch(/^Rules could not finish/)
    expect(requests.some(isJudge)).toBe(false)

    jobs.continue(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const judge = requests.find(isJudge)
    expect(judge?.prompt).not.toContain('- rules:')
    expect(jobs.get(session.id).results[0]?.advice.limitations.join(' ')).toMatch(
      /the judge saw 2 of 3 reviews/,
    )
  })

  it('retries only the reviewers that failed', async () => {
    let rulesFails = true
    const { turns, requests } = recordingTurns((request) => {
      if (request.purpose?.startsWith('Rules') && rulesFails) throw new Error('Rules timed out')
      return reply(request)
    })
    const jobs = panel(turns)
    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    rulesFails = false
    const before = requests.length

    jobs.retry(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    expect(requests.slice(before).map((request) => request.purpose?.split(' ')[0])).toEqual([
      'Rules',
      'Panel',
    ])
  })
})

describe('a reviewer on both providers', () => {
  it('runs once on each provider’s model and the judge weighs the runs as two reviewers', async () => {
    const { turns, requests } = recordingTurns((request) =>
      isJudge(request) ? fixtureJudgeAdvice(['unclebob@codex']) : fixturePanelAdvice(),
    )
    const jobs = panel(turns)

    const session = await jobs.start(
      repository,
      [url],
      [{ id: 'unclebob', providers: [Provider.claude, Provider.codex] }, 'rules'],
    )
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const runs = requests
      .filter((request) => !isJudge(request))
      .map((request) => [request.purpose?.split(' on the panel')[0], request.model.provider])
    expect(runs).toEqual(
      expect.arrayContaining([
        ['Uncle Bob (Claude)', Provider.claude],
        ['Uncle Bob (Codex)', Provider.codex],
        ['Rules', Provider.claude],
      ]),
    )
    expect(requests.find(isJudge)?.model).toEqual(primary)
    expect(requests.find(isJudge)?.prompt).toContain('- unclebob@codex: Uncle Bob (Codex)')
    expect(jobs.get(session.id).reviewers.map((seat) => [seat.id, seat.model])).toEqual([
      ['unclebob@claude', primary],
      ['unclebob@codex', companion],
      ['rules', primary],
    ])
    expect(jobs.get(session.id).results[0]?.advice.findings[0]?.raisedBy).toEqual([
      'unclebob@codex',
    ])
  })

  it('refuses a provider the teammate’s skill is not installed for', async () => {
    await expect(
      panel(recordingTurns(reply).turns).start(
        repository,
        [url],
        [{ id: 'teammate:avery', providers: [Provider.codex] }],
      ),
    ).rejects.toThrow(/AveryReview, is not installed for Codex/)
  })
})

describe('starting a panel', () => {
  it('refuses a teammate whose skill is not installed for the primary model’s provider', async () => {
    installSkill(roots.codex, 'RileyReview')
    await teammates.create({ name: 'Riley', skill: 'RileyReview', maxFindings: 5 })

    await expect(
      panel(recordingTurns(reply).turns).start(repository, [url], ['teammate:riley']),
    ).rejects.toThrow(/RileyReview, is not installed/)
  })

  it('reopens the running panel for the same request and refuses a different one', async () => {
    const turns: StructuredTurns = {
      run: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('Cancelled'))
          })
        }),
    }
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)

    expect((await jobs.start(repository, [url], everyone)).id).toBe(session.id)
    await expect(jobs.start(repository, [url], ['unclebob'])).rejects.toThrow(/Finish or cancel/)
    expect(jobs.cancel(session.id).status).toBe('cancelled')
  })

  it('marks a panel interrupted by a restart as cancelled', async () => {
    const jobs = panel(recordingTurns(reply).turns)
    const session = await jobs.start(repository, [url], ['unclebob'])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })
    store.panel.save({ ...jobs.get(session.id), id: 'interrupted', status: 'running', results: [] })

    expect(jobs.get('interrupted').status).toBe('cancelled')
    expect(store.panel.reviews(repository)).toEqual([
      expect.objectContaining({ url, findingCount: 1, reviewers: ['unclebob'] }),
    ])
  })
})
