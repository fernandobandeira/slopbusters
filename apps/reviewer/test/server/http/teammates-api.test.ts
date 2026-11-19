import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewerStore } from '../../../server/adapters/store'
import { startReviewerServer } from '../../../server/app'
import { fetchPull } from '../../../server/features/pulls/github'
import * as routes from '../../../shared/api'
import { Provider } from '../../../shared/domain/types'
import { reply } from '../../fixtures/panelJobs'
import { fixturePull } from '../../fixtures/pull'
import { installSkill, pngHeader, temporarySkillRoots } from '../../fixtures/skills'
import { recordingTurns } from '../../fixtures/turns'

vi.mock('../../../server/features/pulls/github', async (original) => ({
  ...(await original<typeof import('../../../server/features/pulls/github')>()),
  fetchPull: vi.fn(),
  createPullService: vi.fn(() => ({ fetchPull, fetchPullRevision: vi.fn() })),
}))
vi.mock('../../../server/adapters/reviewWorkspaces', () => ({
  ReviewWorkspaces: class {
    removeAbandoned() {
      return Promise.resolve()
    }
    unused() {
      return Promise.resolve([])
    }
    acquire() {
      return Promise.reject(new Error('No source in fixture'))
    }
    close() {
      return Promise.resolve()
    }
  },
}))

/** No stack and no review history, at once: this test never reaches GitHub. */
const offline = () => Promise.reject(new Error('offline'))
const offlineGitHub = { rest: offline, paginate: offline, graphql: offline }

let data: string
let roots: ReturnType<typeof temporarySkillRoots>
let app: Awaited<ReturnType<typeof startReviewerServer>>
const { turns, requests } = recordingTurns(reply)

beforeEach(async () => {
  data = mkdtempSync(join(tmpdir(), 'teammates-api-'))
  roots = temporarySkillRoots()
  const store = new ReviewerStore({ dataDirectory: data })
  store.savePreferences({ organization: { provider: Provider.claude, model: 'claude-opus-5-5' } })
  store.close()
  app = await startReviewerServer({
    dataDirectory: data,
    staticDirectory: data,
    skillRoots: roots,
    terminatorSkillDirectory: fileURLToPath(
      new URL('../../../../../skills/terminator', import.meta.url),
    ),
    structuredTurns: turns,
    github: offlineGitHub,
    port: 0,
  })
})
afterEach(async () => {
  await app.close()
  rmSync(data, { recursive: true, force: true })
  rmSync(roots.home, { recursive: true, force: true })
  vi.resetAllMocks()
})

function send(method: string, path: string, body?: unknown) {
  return fetch(`${app.url}/api${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

describe('teammates over HTTP', () => {
  it('lists installed skills, creates a teammate from one, and serves its face as a PNG', async () => {
    installSkill(roots.claude, 'AveryReview')
    installSkill(roots.codex, 'AveryReview')
    const skills = routes.listInstalledSkills.response.parse(
      await (await send('GET', '/skills')).json(),
    )
    expect(skills.skills.map((skill) => skill.name)).toEqual(['AveryReview'])

    const created = await send('POST', '/teammates', {
      name: 'Avery',
      skill: 'AveryReview',
      maxFindings: 12,
    })
    expect(created.status).toBe(201)
    const png = pngHeader()
    const saved = await send('PUT', '/teammates/avery/avatars/happy', {
      png: png.toString('base64'),
    })
    expect(routes.saveTeammateAvatar.response.parse(await saved.json()).avatars).toEqual(['happy'])

    const face = await fetch(`${app.url}/api/teammates/avery/avatars/thinking`)
    expect(face.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await face.arrayBuffer())).toEqual(png)
  })

  it('answers 404 for a face that does not exist and 400 for an id that is not a slug', async () => {
    installSkill(roots.claude, 'AveryReview')
    await send('POST', '/teammates', { name: 'Avery', skill: 'AveryReview', maxFindings: 12 })

    expect((await fetch(`${app.url}/api/teammates/avery/avatars/happy`)).status).toBe(404)
    expect((await fetch(`${app.url}/api/teammates/..%2F..%2Fx/avatars/happy`)).status).toBe(400)
    expect(
      (await send('PUT', '/teammates/avery/avatars/happy', { png: 'not base64!' })).status,
    ).toBe(400)
  })
})

describe('the review panel over HTTP', () => {
  it('recovers an interrupted panel through its summary and sends details only for a newer revision', async () => {
    const repository = 'review-room/example'
    const pull = fixturePull()
    const store = new ReviewerStore({ dataDirectory: data })
    try {
      store.panel.save({
        id: 'interrupted',
        repository,
        urls: [pull.url],
        status: 'running',
        model: { provider: Provider.claude, model: 'claude-opus-5-5' },
        reviewers: [{ id: 'unclebob', name: 'Uncle Bob', maxFindings: 10 }],
        progress: 'Reviewing…',
        createdAt: '2026-10-01T00:00:00.000Z',
        results: [],
      })
    } finally {
      store.close()
    }

    const query = new URLSearchParams({ repository, url: pull.url })
    const summary = routes.latestPanel.response.parse(
      await (await send('GET', `/panel/latest?${query.toString()}`)).json(),
    )
    expect(summary.session).toMatchObject({ id: 'interrupted', status: 'cancelled' })
    expect(summary.session).not.toHaveProperty('results')

    const path = '/panel/interrupted'
    const current = routes.getPanel.response.parse(
      await (await send('GET', `${path}?after=0`)).json(),
    )
    expect(current.session?.status).toBe('cancelled')
    expect(
      routes.getPanel.response.parse(
        await (await send('GET', `${path}?after=${String(current.revision)}`)).json(),
      ),
    ).toEqual({ revision: current.revision, session: null })
  })

  it('reviews a PR with a teammate and saves the grounded result for the PR header', async () => {
    vi.mocked(fetchPull).mockResolvedValue(fixturePull())
    installSkill(roots.claude, 'AveryReview')
    await send('POST', '/teammates', { name: 'Avery', skill: 'AveryReview', maxFindings: 12 })
    const repository = 'review-room/example'

    const started = await send('POST', '/panel', {
      repository,
      urls: [fixturePull().url],
      reviewers: ['teammate:avery', 'terminator'],
    })
    expect(started.status).toBe(202)
    const { id } = routes.startPanel.response.parse(await started.json())
    await vi.waitFor(async () => {
      const { session } = routes.getPanel.response.parse(
        await (await send('GET', `/panel/${id}`)).json(),
      )
      expect(session?.status).toBe('complete')
    }, 5000)

    const saved = routes.savedPanelReviews.response.parse(
      await (await send('GET', `/panel/reviews?repository=${repository}`)).json(),
    )
    expect(saved.reviews).toEqual([
      expect.objectContaining({
        sessionId: id,
        findingCount: 1,
        reviewers: ['teammate:avery', 'terminator'],
      }),
    ])
    expect(requests.find((request) => request.purpose?.startsWith('Terminator'))?.prompt).toContain(
      '# Terminator Review',
    )
  })
})
