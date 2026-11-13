import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { StructuredTurnRequest } from '../../../../server/adapters/t3Engine/engineTurns'
import { UserError } from '../../../../server/errors'
import { MAX_PANEL_LAYER_EVIDENCE_CHARS } from '../../../../server/features/panel/limits'
import type { PullRequest } from '../../../../shared/domain/types'
import { DiffSide, type PullReviewBody } from '../../../../shared/domain/types'
import { fixturePanelAdvice, fixturePanelFinding } from '../../../fixtures/panel'
import {
  groundingReply,
  isGrounding,
  panelHarness,
  reply,
  repository,
  url,
} from '../../../fixtures/panelJobs'
import { fixturePull } from '../../../fixtures/pull'
import { recordingTurns } from '../../../fixtures/turns'

const writes = vi.hoisted(() => ({ fail: false }))
vi.mock('../../../../server/adapters/evidenceFolder', async (original) => {
  const real = await original<typeof import('../../../../server/adapters/evidenceFolder')>()
  return {
    writeEvidenceFolder: (files: Parameters<typeof real.writeEvidenceFolder>[0]) =>
      writes.fail
        ? Promise.reject(new Error('The disk is full.'))
        : real.writeEvidenceFolder(files),
  }
})

const harness = panelHarness()
const panel = harness.panel

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
const stackOf = (items: ReturnType<typeof item>[]) => () =>
  Promise.resolve({
    stack: {
      id: 's',
      source: 'github' as const,
      baseBranch: 'main',
      position: 2,
      size: items.length,
      items,
      warnings: [],
    },
    warnings: [],
  })
const stack = stackOf([item(127, 'merged'), item(128), item(131), item(140)])
const loadLayer = (loaded: string) =>
  Promise.resolve(loaded === url ? fixturePull() : layer(Number(loaded.split('/').pop())))
const stackFolder = (request?: StructuredTurnRequest<unknown>) =>
  request?.include?.find((folder) => folder.as === '.slopbusters/stack')?.directory
const topFolder = (request?: StructuredTurnRequest<unknown>) =>
  request?.include?.find((folder) => folder.as === '.slopbusters/stack/top')?.directory
/** Checkouts at `/checkouts/<number>`, with the ones opened and released. */
const checkouts = () => {
  const opened: number[] = []
  const released: number[] = []
  const open = (pull: PullRequest) => {
    opened.push(pull.number)
    return Promise.resolve({
      directory: `/checkouts/${String(pull.number)}`,
      sha: pull.headSha,
      release: () => released.push(pull.number),
    })
  }
  return { open, opened, released }
}
const finish = async (jobs: ReturnType<typeof panel>, reviewers = ['unclebob' as const]) => {
  const session = await jobs.start(repository, [url], reviewers)
  await vi.waitFor(() => {
    expect(jobs.get(session.id).status).toBe('complete')
  })
  return jobs.get(session.id)
}

describe('a PR in a stack', () => {
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
        return loadLayer(loaded)
      },
      stack,
      openRepository: checkouts().open,
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
    expect(result?.advice.limitations.join(' ')).toMatch(
      /top layer, PR #140, could not be opened \(the layer did not load\)/,
    )
  })
})

describe("the stack's layer diffs", () => {
  it('reach seats and grounding as one file per layer, removed afterwards', async () => {
    const seen: { purpose: string; files: string[]; layer?: string }[] = []
    const { turns, requests } = recordingTurns((request) => {
      const folder = stackFolder(request) ?? ''
      seen.push({
        purpose: request.purpose ?? '',
        files: readdirSync(folder).sort(),
        layer: readFileSync(join(folder, '131.json'), 'utf8'),
      })
      return reply(request)
    })

    await finish(panel(turns, { loadPull: loadLayer, stack }))

    expect(seen.map((pass) => pass.purpose)).toEqual([
      expect.stringMatching(/^Uncle Bob/) as string,
      ...Array.from({ length: 3 }, () => expect.stringMatching(/^Panel grounding/) as string),
    ])
    expect(seen.every((pass) => pass.files.join() === '131.json,140.json')).toBe(true)
    expect(JSON.parse(seen[0]?.layer ?? '')).toMatchObject({ title: 'Layer 131' })
    expect(existsSync(stackFolder(requests[0]) ?? '')).toBe(false)
  })
})

describe("the stack's top layer", () => {
  it('lets grounding alone read its source, and releases it with the PR', async () => {
    const source = checkouts()
    const { turns, requests } = recordingTurns(reply)

    await finish(panel(turns, { loadPull: loadLayer, stack, openRepository: source.open }))

    expect(topFolder(requests.find((request) => !isGrounding(request)))).toBeUndefined()
    expect(requests.filter(isGrounding).map(topFolder)).toEqual(
      Array.from({ length: 3 }, () => '/checkouts/140'),
    )
    expect(requests.find(isGrounding)?.prompt).toContain(
      "`.slopbusters/stack/top/` is the source at the head of the stack's top open layer, PR #140",
    )
    expect(source.opened.sort()).toEqual([128, 140])
    expect(source.released.sort()).toEqual([128, 140])
  })

  it('opens no other source when the reviewed PR is the top layer', async () => {
    const source = checkouts()
    const { turns, requests } = recordingTurns(reply)

    await finish(
      panel(turns, {
        loadPull: loadLayer,
        stack: stackOf([item(127, 'merged'), item(131), item(128)]),
        openRepository: source.open,
      }),
    )

    expect(source.opened).toEqual([128])
    expect(requests.filter(isGrounding).map(topFolder)).toEqual([undefined, undefined, undefined])
    expect(requests.find(isGrounding)?.prompt).not.toContain('.slopbusters/stack/top/')
  })

  it('says why grounding could not read the top layer, and still finishes', async () => {
    const { turns } = recordingTurns(reply)
    const open = (pull: PullRequest) =>
      pull.number === 140
        ? Promise.reject(new UserError('The head commit is gone.'))
        : checkouts().open(pull)

    const session = await finish(panel(turns, { loadPull: loadLayer, stack, openRepository: open }))

    expect(session.results[0]?.advice.limitations).toContain(
      "The source of the stack's top layer, PR #140, could not be opened (The head commit is gone.), so grounding could not read the stack as it will land.",
    )
  })
})

describe('a layer too large for the prompt', () => {
  const loadLarge = (loaded: string) =>
    loaded === layerUrl(131)
      ? Promise.resolve({
          ...layer(131),
          warnings: ['w'.repeat(MAX_PANEL_LAYER_EVIDENCE_CHARS)],
        })
      : loadLayer(loaded)

  it('points seats to its file instead of its diff, and limits nothing', async () => {
    const { turns, requests } = recordingTurns(reply)

    const session = await finish(panel(turns, { loadPull: loadLarge, stack }))

    expect(requests[0]?.prompt).toContain(
      'PR #131 (diff left out for size; its whole diff is in `.slopbusters/stack/131.json`):',
    )
    expect(session.results[0]?.advice.limitations.join(' ')).not.toMatch(/too large/)
  })

  it('discloses the outline when its file could not be written', async () => {
    writes.fail = true
    const { turns, requests } = recordingTurns(reply)

    const session = await finish(panel(turns, { loadPull: loadLarge, stack })).finally(() => {
      writes.fail = false
    })

    expect(stackFolder(requests[0])).toBeUndefined()
    expect(requests[0]?.prompt).toContain('PR #131 (diff left out for size):')
    expect(session.results[0]?.advice.limitations).toContain(
      'Stack layers #131 were too large to include whole, and their diffs could not be supplied as files; reviewers saw their titles, descriptions and file lists, not their diffs.',
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
