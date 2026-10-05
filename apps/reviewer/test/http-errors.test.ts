import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { startReviewerServer } from '../server/app'
import { UserError } from '../server/errors'
import type { GitHub } from '../server/adapters/github'

async function withServer(error: Error, test: (url: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'reviewer-errors-'))
  const github: GitHub = {
    rest: vi.fn().mockRejectedValue(error),
    paginate: vi.fn().mockRejectedValue(error),
    graphql: vi.fn().mockRejectedValue(error),
  }
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const app = await startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
    github,
    allowedOrigins: ['http://localhost:5678'],
  })
  try {
    await test(app.url)
  } finally {
    await app.close()
    rmSync(directory, { recursive: true, force: true })
    log.mockRestore()
  }
}

describe('HTTP error boundary', () => {
  it('logs unexpected failures and returns a generic 500 without subprocess output', async () => {
    await withServer(new Error('gh stderr: SECRET_TOKEN'), async (url) => {
      const response = await fetch(`${url}/api/repositories`)
      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ error: 'Something went wrong. Please retry.' })
      expect(console.error).toHaveBeenCalled()
    })
  })

  it('shows explicitly safe user errors and distinguishes missing resources and invalid requests', async () => {
    await withServer(new UserError('Reconnect GitHub.', 409), async (url) => {
      const response = await fetch(`${url}/api/repositories`)
      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'Reconnect GitHub.' })
      expect((await fetch(`${url}/api/pulls/unknown`)).status).toBe(404)
      expect(
        (
          await fetch(`${url}/api/pulls`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(400)
    })
  })

  it('derives development websocket origins from the configured app origin', async () => {
    await withServer(new Error('offline'), async (url) => {
      const response = await fetch(`${url}/api/preferences`)
      expect(response.headers.get('Content-Security-Policy')).toContain('ws://localhost:5678')
      expect(response.headers.get('Content-Security-Policy')).not.toContain(':4310')
    })
  })
})
