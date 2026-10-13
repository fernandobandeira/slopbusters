import { mkdtempSync, rmSync } from 'node:fs'
import { Agent, request } from 'node:http'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitHub } from '../server/adapters/github'
import { startReviewerServer } from '../server/app'

const directories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('server shutdown', () => {
  it('closes a connection the browser opened but never used', async () => {
    const server = await start()
    const socket = await openConnection(server.url)
    const hungUp = new Promise((resolve) => {
      socket.once('close', () => {
        resolve(true)
      })
    })

    await expect(within(server.close(), 2000)).resolves.toBeUndefined()

    await expect(within(hungUp, 1000)).resolves.toBe(true)
    socket.destroy()
  })

  it('answers a request in flight with Connection: close and closes once it finishes', async () => {
    const github = pendingGitHub()
    const server = await start(github)
    const agent = new Agent({ keepAlive: true })
    const response = get(`${server.url}/api/repositories`, agent)
    await vi.waitFor(() => {
      expect(github.calls()).toBeGreaterThan(0)
    })
    const closing = server.close()

    github.fail(new Error('offline'))

    expect((await response).connection).toBe('close')
    await expect(within(closing, 2000)).resolves.toBeUndefined()
    agent.destroy()
  })
})

async function start(github: GitHub = pendingGitHub()) {
  const directory = mkdtempSync(join(tmpdir(), 'reviewer-shutdown-'))
  directories.push(directory)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  return startReviewerServer({
    dataDirectory: directory,
    staticDirectory: directory,
    port: 0,
    github,
  })
}

/** GitHub calls that stay pending until the test fails them. */
function pendingGitHub() {
  const waiting: ((error: Error) => void)[] = []
  const pending = () =>
    new Promise<never>((_resolve, reject) => {
      waiting.push(reject)
    })
  return {
    rest: pending,
    paginate: pending,
    graphql: pending,
    calls: () => waiting.length,
    fail: (error: Error) => {
      for (const reject of waiting) reject(error)
    },
  }
}

/** Browsers open spare connections to an origin before they have a request to send. */
async function openConnection(url: string): Promise<Socket> {
  const { hostname, port } = new URL(url)
  const socket = connect(Number(port), hostname)
  socket.on('error', () => undefined)
  await new Promise((resolve) => socket.once('connect', resolve))
  // Let the server accept it, so it is an open connection rather than a queued one.
  await new Promise((resolve) => setTimeout(resolve, 100))
  return socket
}

function get(url: string, agent: Agent) {
  return new Promise<{ connection?: string }>((resolve, reject) => {
    request(url, { agent }, (response) => {
      response.resume()
      response.once('end', () => {
        resolve({ connection: response.headers.connection })
      })
    })
      .once('error', reject)
      .end()
  })
}

function within<T>(promise: Promise<T>, milliseconds: number) {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new Error(`Still waiting after ${milliseconds} ms.`))
      }, milliseconds)
    }),
  ])
}
