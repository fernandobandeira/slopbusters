import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import { ReviewerStore } from '../server/adapters/store'
import { organizePull } from '../server/features/organization/organize'
import { Provider, type ChangeGroup } from '../shared/domain/types'
import { fixturePull } from './fixtures/pull'

vi.mock('../server/features/organization/organize', () => ({ organizePull: vi.fn() }))
const paths: string[] = []
afterEach(() => {
  vi.resetAllMocks()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

async function server() {
  const path = mkdtempSync(join(tmpdir(), 'organization-api-'))
  paths.push(path)
  const store = new ReviewerStore({ dataDirectory: path })
  store.savePull(fixturePull())
  store.close()
  return startReviewerServer({ dataDirectory: path, staticDirectory: path, port: 0 })
}
const organization = { provider: Provider.claude, model: 'claude-opus-5-5' }
function put(url: string, body: unknown) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function organize(url: string, force = false) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force }),
  })
}

describe('automatic organization API', () => {
  it('requires setup, validates model IDs, and merges organization with appearance', async () => {
    const app = await server()
    try {
      const prefs = `${app.url}/api/preferences`
      const run = await organize(`${app.url}/api/pulls/${fixturePull().id}/organize`)
      expect(run.status).toBe(400)
      expect(organizePull).not.toHaveBeenCalled()
      expect((await put(prefs, { organization: { ...organization, model: ' ' } })).status).toBe(400)
      expect(
        (await put(prefs, { organization: { ...organization, model: '--flag' } })).status,
      ).toBe(400)
      expect(
        (await put(prefs, { organization: { ...organization, provider: 'other' } })).status,
      ).toBe(400)
      await put(prefs, { theme: 'nord' })
      await put(prefs, { organization })
      await put(prefs, { theme: 'github-dark' })
      expect(await (await fetch(prefs)).json()).toEqual({ theme: 'github-dark', organization })
    } finally {
      await app.close()
    }
  })

  it('uses saved settings, joins concurrent requests, reuses groups, and explicitly regenerates', async () => {
    const app = await server()
    let finish!: (groups: ChangeGroup[]) => void
    vi.mocked(organizePull).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pull = fixturePull()
    const url = `${app.url}/api/pulls/${pull.id}/organize`
    try {
      await put(`${app.url}/api/preferences`, { organization })
      const first = (await (await organize(url)).json()) as { id: string }
      const second = await (await organize(url)).json()
      expect(second).toEqual(first)
      expect(organizePull).toHaveBeenCalledExactlyOnceWith(
        pull,
        organization,
        expect.any(AbortSignal),
        expect.any(Function),
      )
      finish(pull.groups)
      await vi.waitFor(async () => {
        expect(await (await fetch(`${app.url}/api/jobs/${first.id}`)).json()).toMatchObject({
          status: 'complete',
        })
      })
      expect(await (await organize(url)).json()).toEqual({ complete: true })
      expect(organizePull).toHaveBeenCalledTimes(1)
      await organize(url, true)
      expect(organizePull).toHaveBeenCalledTimes(2)
      finish(pull.groups)
    } finally {
      await app.close()
    }
  })

  it('exposes failures and permits a retry with updated settings', async () => {
    const app = await server()
    vi.mocked(organizePull).mockRejectedValue(new Error('Model is unavailable'))
    const url = `${app.url}/api/pulls/${fixturePull().id}/organize`
    try {
      await put(`${app.url}/api/preferences`, { organization })
      const job = (await (await organize(url)).json()) as { id: string }
      await vi.waitFor(async () => {
        expect(await (await fetch(`${app.url}/api/jobs/${job.id}`)).json()).toMatchObject({
          status: 'failed',
          error: 'Organization failed. Please retry.',
        })
      })
      const next = { provider: Provider.codex, model: 'custom-model' }
      await put(`${app.url}/api/preferences`, { organization: next })
      await organize(url)
      expect(organizePull).toHaveBeenLastCalledWith(
        fixturePull(),
        next,
        expect.any(AbortSignal),
        expect.any(Function),
      )
    } finally {
      await app.close()
    }
  })
})
