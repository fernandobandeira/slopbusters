import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
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
import { fixtureJudgeAdvice, fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
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

const everyone: ReviewerId[] = ['unclebob', 'terminator', 'teammate:avery']

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
    expect(avery?.prompt).toContain('most likely first')
    expect(avery?.prompt).toContain('Return at most 5.')
    const bob = reviews.find((request) => request.purpose?.startsWith('Uncle Bob'))
    expect(bob?.prompt).toContain('Report at most 10 findings')
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

describe('a seat that returns its full cap', () => {
  it('is marked as possibly having more, and the judge’s result says so', async () => {
    const five = Array.from({ length: 5 }, (_, index) =>
      fixturePanelFinding({ id: `finding-${String(index)}` }),
    )
    const { turns } = recordingTurns((request) =>
      request.purpose?.startsWith('Avery') ? fixturePanelAdvice(five) : reply(request),
    )
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const [result] = jobs.get(session.id).results
    const capped = result?.reviews.filter((review) => review.capped)
    expect(capped?.map((review) => review.reviewer)).toEqual(['teammate:avery'])
    expect(
      result?.reviews
        .find((review) => review.reviewer === 'teammate:avery')
        ?.advice?.findings.map((finding) => finding.id),
    ).toEqual(five.map((finding) => finding.id))
    expect(result?.advice.limitations).toContain(
      'Avery returned as many findings as allowed and may have had more.',
    )
  })
})

describe('the panel judge', () => {
  it('judges by its own rubric alone, with each teammate’s skill folder to check citations', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const judge = requests.find(isJudge)
    expect(judge?.prompt).toContain('Do not load or follow other skills')
    expect(judge?.prompt).toContain('- teammate:avery: `.slopbusters/skills/avery/`')
    expect(judge?.include).toEqual([
      {
        directory: expect.stringMatching(/AveryReview$/) as string,
        as: '.slopbusters/skills/avery',
      },
    ])
  })

  it('copies a skill folder once when both providers’ seats share it', async () => {
    mkdirSync(roots.codex, { recursive: true })
    symlinkSync(join(roots.claude, 'AveryReview'), join(roots.codex, 'AveryReview'))
    const { turns, requests } = recordingTurns(reply)
    const jobs = panel(turns)
    const both = [Provider.claude, Provider.codex]

    const session = await jobs.start(repository, [url], [{ id: 'teammate:avery', providers: both }])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const judge = requests.find(isJudge)
    expect(judge?.include?.map((folder) => folder.as)).toEqual(['.slopbusters/skills/avery@claude'])
    expect(judge?.prompt).toContain('- teammate:avery@codex: `.slopbusters/skills/avery@claude/`')
  })
})

describe('a panel reviewer that fails', () => {
  it('waits on the user when a reviewer fails, then judges with the reviews that finished', async () => {
    const { turns, requests } = recordingTurns((request) => {
      if (request.purpose?.startsWith('Terminator')) throw new Error('Terminator timed out')
      return reply(request)
    })
    const jobs = panel(turns)

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    expect(jobs.get(session.id).progress).toMatch(/^Terminator could not finish/)
    expect(requests.some(isJudge)).toBe(false)

    jobs.continue(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const judge = requests.find(isJudge)
    expect(judge?.prompt).not.toContain('- terminator:')
    expect(jobs.get(session.id).results[0]?.advice.limitations.join(' ')).toMatch(
      /the judge saw 2 of 3 reviews/,
    )
  })

  it('retries only the reviewers that failed', async () => {
    let terminatorFails = true
    const { turns, requests } = recordingTurns((request) => {
      if (request.purpose?.startsWith('Terminator') && terminatorFails)
        throw new Error('Terminator timed out')
      return reply(request)
    })
    const jobs = panel(turns)
    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('partial')
    })
    terminatorFails = false
    const before = requests.length

    jobs.retry(session.id)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    expect(requests.slice(before).map((request) => request.purpose?.split(' ')[0])).toEqual([
      'Terminator',
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
      [{ id: 'unclebob', providers: [Provider.claude, Provider.codex] }, 'terminator'],
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
        ['Terminator', Provider.claude],
      ]),
    )
    expect(requests.find(isJudge)?.model).toEqual(primary)
    expect(requests.find(isJudge)?.prompt).toContain('- unclebob@codex: Uncle Bob (Codex)')
    expect(jobs.get(session.id).reviewers.map((seat) => [seat.id, seat.model])).toEqual([
      ['unclebob@claude', primary],
      ['unclebob@codex', companion],
      ['terminator', primary],
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
  it('seats a teammate on every provider its skill is installed for unless asked otherwise', async () => {
    installSkill(roots.codex, 'AveryReview')
    installSkill(roots.codex, 'RileyReview')
    await teammates.create({ name: 'Riley', skill: 'RileyReview', maxFindings: 5 })
    const jobs = panel(recordingTurns(reply).turns)

    const session = await jobs.start(
      repository,
      [url],
      [
        'teammate:avery',
        'teammate:riley',
        'unclebob',
        { id: 'terminator', providers: [Provider.codex] },
      ],
    )

    expect(session.reviewers.map((seat) => [seat.id, seat.model?.provider])).toEqual([
      ['teammate:avery@claude', Provider.claude],
      ['teammate:avery@codex', Provider.codex],
      ['teammate:riley', Provider.codex],
      ['unclebob', Provider.claude],
      ['terminator', Provider.codex],
    ])
    jobs.cancel(session.id)
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
