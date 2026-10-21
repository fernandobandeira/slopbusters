import { describe, expect, it, vi } from 'vitest'
import { UserError } from '../server/errors'
import { DiffSide } from '../shared/domain/types'
import { fixtureJudgeAdvice, fixturePanelAdvice, fixturePanelFinding } from './fixtures/panel'
import { everyone, isJudge, panelHarness, reply, repository, url } from './fixtures/panelJobs'
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
      if (isJudge(request)) return fixtureJudgeAdvice(['unclebob'])
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

    const seat = requests.find((request) => !isJudge(request))
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

describe('a teammate with a GitHub login', () => {
  it('reads what that reviewer already said on the PR, threads and review bodies', async () => {
    await harness.teammates.update('avery', {
      name: 'Avery',
      skill: 'AveryReview',
      maxFindings: 5,
      login: 'avery',
    })
    const { turns, requests } = recordingTurns(reply)
    const loadHistory = vi.fn(() => Promise.resolve(history))
    const jobs = panel(turns, {
      loadPull: () => Promise.resolve(fixturePull()),
      history: loadHistory,
    })

    const session = await jobs.start(repository, [url], ['teammate:avery', 'unclebob'])
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    const avery = requests.find((request) => request.purpose?.startsWith('Avery'))
    expect(avery?.prompt).toContain('What Avery (@avery) already said on this PR')
    expect(avery?.prompt).toContain('Name the role check.')
    expect(avery?.prompt).toContain('"resolved":true')
    expect(avery?.prompt).toContain('Looks close; one naming nit.')
    expect(avery?.prompt).not.toContain('Someone else entirely.')
    const bob = requests.find((request) => request.purpose?.startsWith('Uncle Bob'))
    expect(bob?.prompt).not.toContain('already said on this PR')
  })

  it('does not load comments when no seat has a login', async () => {
    const loadHistory = vi.fn(() => Promise.resolve(history))
    const jobs = panel(recordingTurns(reply).turns, {
      loadPull: () => Promise.resolve(fixturePull()),
      history: loadHistory,
    })

    const session = await jobs.start(repository, [url], everyone)
    await vi.waitFor(() => {
      expect(jobs.get(session.id).status).toBe('complete')
    })

    expect(loadHistory).not.toHaveBeenCalled()
  })
})
