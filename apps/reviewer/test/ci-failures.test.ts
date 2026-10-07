import { describe, expect, it, vi } from 'vitest'
import { failedStep, loadCiFailures } from '../server/adapters/ciFailures'
import type { GitHub } from '../server/adapters/github'
import { NetworkError } from '../server/adapters/network'
import { fixturePull } from './fixtures/pull'

const log = [
  '2026-10-07T19:10:00.0000000Z ##[group]Run pnpm install',
  '2026-10-07T19:10:01.0000000Z install error that was retried',
  '2026-10-07T19:10:02.0000000Z ##[endgroup]',
  '2026-10-07T19:14:00.0000000Z ##[group]Run pnpm test',
  "2026-10-07T19:14:11.6453484Z \u001b[31mtest/a.test.ts:44:7 - error TS2741: Property 'created_at' is missing\u001b[0m",
  '2026-10-07T19:14:11.8865259Z ##[error]Process completed with exit code 2.',
  '2026-10-07T19:14:12.0000000Z Post job cleanup.',
].join('\r\n')

describe('failed CI step extraction', () => {
  it('keeps only the step that raised the last error, without timestamps or colors', () => {
    expect(failedStep(log)).toBe(
      [
        '##[group]Run pnpm test',
        "test/a.test.ts:44:7 - error TS2741: Property 'created_at' is missing",
        '##[error]Process completed with exit code 2.',
      ].join('\n'),
    )
  })
  it('surfaces error lines that fall outside the kept tail of a long step', () => {
    const noisy = [
      '##[group]Run pnpm test',
      'FAIL test/early.test.ts',
      ...Array.from({ length: 5000 }, (_, index) => `passing output ${String(index)}`),
      '##[error]Process completed with exit code 1.',
    ].join('\n')
    const step = failedStep(noisy)
    expect(step.startsWith('FAIL test/early.test.ts\n…\n')).toBe(true)
    expect(step.endsWith('##[error]Process completed with exit code 1.')).toBe(true)
    expect(step.length).toBeLessThan(52_000)
  })
})

describe('failing CI checks', () => {
  function github(logs: () => Promise<unknown>) {
    const rest = vi.fn<GitHub['rest']>((endpoint) => {
      if (endpoint.includes('/check-runs'))
        return Promise.resolve({
          check_runs: [
            {
              id: 7,
              name: 'build-and-test-server',
              conclusion: 'failure',
              html_url: 'https://github.com/review-room/example/actions/runs/1/job/7',
              app: { slug: 'github-actions' },
              output: { title: 'Tests failed', summary: null },
            },
            { id: 8, name: 'lint', conclusion: 'success', app: { slug: 'github-actions' } },
            { id: 9, name: 'external', conclusion: 'timed_out', app: { slug: 'circleci' } },
          ],
        })
      if (endpoint.endsWith('/status'))
        return Promise.resolve({
          statuses: [
            { context: 'deploy', state: 'error', description: 'Preview failed' },
            { context: 'coverage', state: 'success' },
          ],
        })
      return logs()
    })
    return { rest, github: { rest, paginate: vi.fn(), graphql: vi.fn() } satisfies GitHub }
  }

  it('reports failed check runs and statuses with the failed step of Actions logs', async () => {
    const { rest, github: client } = github(() => Promise.resolve(log))
    const failures = await loadCiFailures(client, fixturePull(), new AbortController().signal)
    expect(failures).toEqual([
      {
        name: 'build-and-test-server',
        url: 'https://github.com/review-room/example/actions/runs/1/job/7',
        summary: 'Tests failed',
        log: failedStep(log),
      },
      { name: 'external', url: undefined, summary: '', log: '' },
      { name: 'deploy', url: undefined, summary: 'Preview failed', log: '' },
    ])
    expect(rest).toHaveBeenCalledWith(
      'repos/review-room/example/actions/jobs/7/logs',
      expect.objectContaining({ raw: true, allowEscapeSequences: true }),
    )
    expect(rest.mock.calls[0]?.[0]).toBe(
      `repos/review-room/example/commits/${fixturePull().headSha}/check-runs?filter=latest&per_page=100`,
    )
  })
  it('keeps the check without a log when GitHub no longer has it', async () => {
    const { github: client } = github(() => Promise.reject(new Error('HTTP 410: logs expired')))
    const [failure] = await loadCiFailures(client, fixturePull(), new AbortController().signal)
    expect(failure).toMatchObject({ name: 'build-and-test-server', log: '' })
  })
  it('lets the job retry a dropped connection instead of hiding the log', async () => {
    const outage = new NetworkError('GitHub could not be reached.', new Error('timeout'))
    const { github: client } = github(() => Promise.reject(outage))
    await expect(loadCiFailures(client, fixturePull(), new AbortController().signal)).rejects.toBe(
      outage,
    )
  })
})
