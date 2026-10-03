const { EventEmitter } = require('node:events')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createUpdates } = require('../src/updates.cjs')

function setup(t, enabled = true) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const updater = new EventEmitter()
  updater.checkForUpdates = t.mock.fn(async () => {
    updater.emit('checking-for-update')
    updater.emit('update-not-available')
  })
  updater.downloadUpdate = t.mock.fn(async () => [])
  updater.quitAndInstall = t.mock.fn()
  const states = []
  const updates = createUpdates({ updater, enabled, publish: (state) => states.push(state) })
  t.after(() => updates.dispose())
  return { updater, updates, states }
}

test('development builds never contact the release feed', async (t) => {
  const { updater, updates } = setup(t, false)
  await updates.check()
  t.mock.timers.tick(600000)
  assert.equal(updater.checkForUpdates.mock.callCount(), 0)
  assert.equal(updates.state().status, 'disabled')
})

test('startup and periodic checks preserve an available update', async (t) => {
  const { updater, updates } = setup(t)
  t.mock.timers.tick(15000)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(updater.checkForUpdates.mock.callCount(), 1)
  t.mock.timers.tick(225000)
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(updater.checkForUpdates.mock.callCount(), 2)
  updater.emit('update-available', { version: '0.2.0' })
  t.mock.timers.tick(240000)
  assert.equal(updater.checkForUpdates.mock.callCount(), 2)
  assert.deepEqual(updates.state(), { status: 'available', version: '0.2.0' })
})

test('download and install require separate actions and a completed download', async (t) => {
  const { updater, updates } = setup(t)
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowPrerelease, false)
  assert.equal(updater.allowDowngrade, false)
  updater.emit('update-available', { version: '0.2.0' })
  assert.equal(updater.downloadUpdate.mock.callCount(), 0)
  updates.install()
  assert.equal(updater.quitAndInstall.mock.callCount(), 0)
  await updates.download()
  updater.emit('download-progress', { percent: 42.5 })
  assert.deepEqual(updates.state(), { status: 'downloading', version: '0.2.0', percent: 42.5 })
  updater.emit('update-downloaded', { version: '0.2.0' })
  updates.install()
  assert.deepEqual(updater.quitAndInstall.mock.calls[0].arguments, [false, true])
})

test('a later check recovers from a network failure', async (t) => {
  const { updater, updates } = setup(t)
  updater.checkForUpdates.mock.mockImplementationOnce(async () => { throw new Error('Offline') })
  await updates.check()
  assert.deepEqual(updates.state(), { status: 'error', message: 'Offline' })
  await updates.check()
  assert.equal(updates.state().status, 'idle')
})

test('concurrent requests cannot overlap checks', async (t) => {
  const { updater, updates } = setup(t)
  let finish
  updater.checkForUpdates.mock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const first = updates.check()
  await updates.check()
  assert.equal(updater.checkForUpdates.mock.callCount(), 1)
  finish()
  await first
})

test('disposing the updater releases its timers and subscriptions', async (t) => {
  const { updater, updates, states } = setup(t)
  updates.dispose()
  t.mock.timers.tick(600000)
  updater.emit('update-available', { version: '0.2.0' })
  assert.equal(updater.checkForUpdates.mock.callCount(), 0)
  assert.deepEqual(states, [])
})
