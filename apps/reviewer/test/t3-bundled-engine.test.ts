import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { BundledEngine } from '../server/adapters/t3Engine/bundledEngine'
import type { RunningEngine } from '../server/adapters/t3Engine/engineLocation'
import { UserError } from '../server/errors'

const home = '/data/t3-engine'
const executable = process.execPath

function engineAt(pid: number): RunningEngine {
  return {
    home,
    pid,
    origin: 'http://127.0.0.1:50123',
    environmentId: 'e',
    serverVersion: '0.0.45',
  }
}

/** A child process that stays up until killed. */
function fakeChild(pid: number) {
  const child = new EventEmitter() as ChildProcess & EventEmitter
  Object.assign(child, { pid, exitCode: null, signalCode: null })
  const kill = vi.fn((signal?: NodeJS.Signals | number) => {
    Object.assign(child, { signalCode: signal ?? 'SIGTERM' })
    child.emit('exit', null, signal)
    return true
  })
  child.kill = kill
  return { child, kill }
}

describe('the bundled engine', () => {
  it('serves on a free loopback port in its own home and waits until it answers', async () => {
    const { child, kill } = fakeChild(31)
    const spawnEngine = vi.fn(() => child)
    let checks = 0
    const locate = vi.fn(() => {
      checks += 1
      // The first check finds no leftover; the engine answers on the third.
      return checks < 3
        ? Promise.reject(new UserError('T3 Code is not running.'))
        : Promise.resolve(engineAt(31))
    })
    const bundled = new BundledEngine({
      executable,
      home,
      locate,
      spawnEngine,
      freePort: () => Promise.resolve(50123),
    })

    const running = await bundled.ensureRunning()

    expect(running.pid).toBe(31)
    expect(spawnEngine).toHaveBeenCalledWith(executable, [
      'serve',
      '--base-dir',
      home,
      '--host',
      '127.0.0.1',
      '--port',
      '50123',
    ])
    await bundled.close()
    expect(kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('adopts an engine a previous run left in its home instead of starting another', async () => {
    const spawnEngine = vi.fn()
    const bundled = new BundledEngine({
      executable,
      home,
      locate: () => Promise.resolve(engineAt(99)),
      spawnEngine,
    })

    const [first, second] = await Promise.all([bundled.ensureRunning(), bundled.ensureRunning()])

    expect(first).toBe(second)
    expect(first.pid).toBe(99)
    expect(spawnEngine).not.toHaveBeenCalled()
  })

  it('reports an engine that exits while starting, then starts afresh on the next call', async () => {
    const crashed = fakeChild(41).child
    Object.assign(crashed, { exitCode: 1 })
    const spawnEngine = vi
      .fn()
      .mockReturnValueOnce(crashed)
      .mockReturnValueOnce(fakeChild(42).child)
    const locate = vi
      .fn()
      .mockRejectedValueOnce(new UserError('T3 Code is not running.'))
      .mockRejectedValueOnce(new UserError('T3 Code is not running.'))
      .mockResolvedValue(engineAt(42))
    const bundled = new BundledEngine({
      executable,
      home,
      locate,
      spawnEngine,
      freePort: () => Promise.resolve(1),
    })

    await expect(bundled.ensureRunning()).rejects.toThrow('stopped while starting')
    const running = await bundled.ensureRunning()

    expect(running.pid).toBe(42)
  })

  it('explains when this build does not include the engine', async () => {
    const bundled = new BundledEngine({
      executable: '/missing/t3',
      home,
      locate: () => Promise.reject(new UserError('T3 Code is not running.')),
    })

    await expect(bundled.ensureRunning()).rejects.toThrow('does not include the T3 Code engine')
  })
})

describe('an engine that stops after it was found', () => {
  it('replaces an adopted engine once it has stopped, instead of calling its old port', async () => {
    const alive = new Set([99])
    const locate = vi.fn(() =>
      alive.has(99)
        ? Promise.resolve(engineAt(99))
        : alive.has(52)
          ? Promise.resolve(engineAt(52))
          : Promise.reject(new UserError('T3 Code is not running.')),
    )
    const spawnEngine = vi.fn(() => {
      alive.add(52)
      return fakeChild(52).child
    })
    const bundled = new BundledEngine({
      executable,
      home,
      locate,
      spawnEngine,
      freePort: () => Promise.resolve(1),
      isAlive: (pid) => alive.has(pid),
    })
    expect((await bundled.ensureRunning()).pid).toBe(99)

    alive.delete(99)
    const replaced = await bundled.ensureRunning()

    expect(replaced.pid).toBe(52)
    expect(spawnEngine).toHaveBeenCalledTimes(1)
  })
})
