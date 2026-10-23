import { describe, expect, it, vi } from 'vitest'
import { UserError } from '../server/errors'
import { DiffSide, type PullReviewBody } from '../shared/domain/types'
import { fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
import {
  groundingReply,
  isGrounding,
  panelHarness,
  reply,
  repository,
  url,
} from './fixtures/panelJobs'
import { fixturePull } from './fixtures/pull'
import { recordingTurns } from './fixtures/turns'

const harness = panelHarness()
const panel = harness.panel

describe('a PR in a stack', () => {
  const layerUrl = (number: number) => url.replace(/\d+$/, String(number))
  const layer = (number: number) => ({
    ...fixturePull(),
    number,
    url: layerUrl(number),
    title: `Layer ${String(number)}`,
  })
  const item = (number: number, state: 'open' | 'merged' = 'open') => ({
    number,
    url: number === 128 ? url : layerUrl(number),
    title: `Layer ${String(number)}`,
    repository,
    headBranch: `layer-${String(number)}`,
    baseBranch: 'main',
    state,
    isDraft: false,
  })
  const stack = () =>
    Promise.resolve({
      stack: {
        id: 's',
        source: 'github' as const,
        baseBranch: 'main',
        position: 2,
        size: 4,
        items: [item(127, 'merged'), item(128), item(131), item(140)],
        warnings: [],
      },
      warnings: [],
    })

  it('loads the other open layers before any seat starts and lets seats anchor on them', async () => {
    const loads: string[] = []
    const { turns, requests } = recordingTurns((request) => {
      if (isGrounding(request)) return groundingReply(request)
      expect(loads).toEqual([url, layerUrl(131), layerUrl(140)])
      return fixturePanelAdvice([
        fixturePanelFinding({
          id: 'rename-above',
          anchor: { kind: 'stack', pull: 131, location: { kind: 'description', field: 'title' } },
        }),
      ])
    })
    const jobs = panel(turns, {
      loadPull: (loaded) => {
        loads.push(loaded)
        if (loaded === layerUrl(140)) return Promise.reject(new UserError('Not found.'))
        return Promise.resolve(
          loaded === url ? fixturePull() : layer(Number(loaded.split('/').pop())),
        )
      },
      stack,
    })

    const session = await jobs.start(repository, [url], ['unclebob'])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const seat = requests.find((request) => !isGrounding(request))
    expect(seat?.prompt).toContain("Other open layers of this PR's stack")
    expect(seat?.prompt).toContain('PR #131:')
    expect(seat?.prompt).toContain("by that layer's PR number (#131)")
    const [result] = jobs.get(session.id).results
    expect(result?.reviews[0]?.advice?.findings[0]?.anchor).toMatchObject({
      kind: 'stack',
      pull: 131,
      fingerprint: expect.any(String) as string,
    })
    expect(result?.advice.limitations.join(' ')).toMatch(
      /Other stack layers could not be loaded.*PR #140 \(Not found\.\)/,
    )
  })
})

const comment = (author: string, body: string) => ({
  id: body.length.toString(),
  author,
  body,
  url: 'https://github.com/review-room/example/pull/128#discussion_r1',
  createdAt: '2026-10-01T12:00:00Z',
})
const history = {
  threads: [
    {
      id: 'mine',
      path: 'src/access/permissions.ts',
      line: 5,
      originalLine: 5,
      side: DiffSide.right,
      resolved: true,
      outdated: false,
      canReply: true,
      comments: [comment('Avery', 'Name the role check.'), comment('author', 'Done.')],
    },
    {
      id: 'theirs',
      path: 'src/lib/slug.ts',
      line: 1,
      originalLine: 1,
      side: DiffSide.right,
      resolved: false,
      outdated: false,
      canReply: true,
      comments: [comment('riley', 'Someone else entirely.')],
    },
  ],
  reviews: [
    {
      id: '9',
      author: 'avery',
      state: 'COMMENTED',
      body: 'Looks close; one naming nit.',
      url: 'https://github.com/review-room/example/pull/128#pullrequestreview-9',
      submittedAt: '2026-10-01T12:05:00Z',
      commitId: fixturePull().headSha,
    },
  ],
}

describe('what reviewers already said on the PR', () => {
  it('reaches every seat, threads and review bodies from every author', async () => {
    const { turns, requests } = recordingTurns(reply)
    const jobs = panel(turns, {
      loadPull: () => Promise.resolve(fixturePull()),
      history: () => Promise.resolve(history),
    })

    const session = await jobs.start(repository, [url], ['teammate:avery', 'unclebob'])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    for (const seat of ['Avery', 'Uncle Bob']) {
      const prompt = requests.find((request) => request.purpose?.startsWith(seat))?.prompt
      expect(prompt).toContain('What reviewers already said on this PR')
      expect(prompt).toContain('Name the role check.')
      expect(prompt).toContain('"resolved":true')
      expect(prompt).toContain('Looks close; one naming nit.')
      expect(prompt).toContain('Someone else entirely.')
    }
  })

  it('keeps the newest comments when they exceed the budget', async () => {
    const long = (index: number): PullReviewBody => ({
      author: 'avery',
      state: 'COMMENTED',
      url: `https://github.com/review-room/example/pull/128#pullrequestreview-${String(index)}`,
      commitId: fixturePull().headSha,
      id: String(index),
      body: `Review ${String(index)} ${'x'.repeat(25_000)}`,
      submittedAt: `2026-10-0${String(index)}T12:00:00Z`,
    })
    const { turns, requests } = recordingTurns(reply)
    const jobs = panel(turns, {
      loadPull: () => Promise.resolve(fixturePull()),
      history: () => Promise.resolve({ threads: [], reviews: [1, 2, 3, 4].map(long) }),
    })

    const session = await jobs.start(repository, [url], ['unclebob'])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const prompt = requests.find((request) => request.purpose?.startsWith('Uncle Bob'))?.prompt
    expect(prompt).toContain('2 older entries were left out for size.')
    expect(prompt).not.toContain('Review 1 ')
    expect(prompt).not.toContain('Review 2 ')
    expect(prompt?.indexOf('Review 3 ')).toBeLessThan(prompt?.indexOf('Review 4 ') ?? 0)
  })
})
