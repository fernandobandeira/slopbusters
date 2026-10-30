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
    serverVersion: '0.1.0',
  }
}

/** A child process that stays up until killed. */
function fakeChild(pid: number) {
  const child = new EventEmitter() as ChildProcess & EventEmitter
  Object.assign(child, {
    pid,
    exitCode: null,
    signalCode: null,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  })
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

describe('an engine a previous run left behind', () => {
  it('stops an engine a previous run left in its home, then starts its own', async () => {
    const { child } = fakeChild(31)
    const spawnEngine = vi.fn(() => child)
    const stopLeftover = vi.fn(() => Promise.resolve())
    const locate = vi.fn().mockResolvedValueOnce(engineAt(99)).mockResolvedValue(engineAt(31))
    const bundled = new BundledEngine({
      executable,
      home,
      locate,
      spawnEngine,
      stopLeftover,
      freePort: () => Promise.resolve(1),
    })

    const [first, second] = await Promise.all([bundled.ensureRunning(), bundled.ensureRunning()])

    expect(first).toBe(second)
    expect(first.pid).toBe(31)
    expect(stopLeftover).toHaveBeenCalledWith(99)
    expect(spawnEngine).toHaveBeenCalledTimes(1)
    await bundled.close()
  })
})

describe('an engine that stops on its own', () => {
  it('reports why, and starts another on the next use', async () => {
    const first = fakeChild(51)
    const spawnEngine = vi
      .fn()
      .mockReturnValueOnce(first.child)
      .mockReturnValueOnce(fakeChild(52).child)
    let pid = 51
    const locate = vi
      .fn()
      .mockRejectedValueOnce(new UserError('T3 Code is not running.'))
      .mockImplementation(() => Promise.resolve(engineAt(pid)))
    const onUnexpectedExit = vi.fn()
    const bundled = new BundledEngine({
      executable,
      home,
      locate,
      spawnEngine,
      onUnexpectedExit,
      freePort: () => Promise.resolve(1),
    })
    expect((await bundled.ensureRunning()).pid).toBe(51)

    first.child.stderr?.emit('data', Buffer.from('fatal: out of memory'))
    Object.assign(first.child, { signalCode: 'SIGKILL' })
    first.child.emit('exit', null, 'SIGKILL')
    pid = 52
    const replaced = await bundled.ensureRunning()

    expect(onUnexpectedExit).toHaveBeenCalledWith(
      expect.stringMatching(/exit code null, signal SIGKILL\nfatal: out of memory/),
    )
    expect(replaced.pid).toBe(52)
    await bundled.close()
    expect(onUnexpectedExit).toHaveBeenCalledOnce()
  })
})
