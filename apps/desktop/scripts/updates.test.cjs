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

test('failures are logged once with their cause and updater diagnostics share the log', async (t) => {
  const { updater } = setup(t)
  const entries = []
  const log = { info() {}, warn() {}, debug() {}, error: (...parts) => entries.push(parts) }
  const updates = createUpdates({ updater, enabled: true, publish: () => {}, log })
  t.after(() => updates.dispose())
  assert.equal(updater.logger, log)
  const missingFeed = new Error("ENOENT: no such file or directory, open 'app-update.yml'")
  updater.checkForUpdates.mock.mockImplementationOnce(async () => {
    updater.emit('error', missingFeed)
    throw missingFeed
  })
  await updates.check()
  assert.deepEqual(entries, [['Update failed:', missingFeed]])
  assert.deepEqual(updates.state(), { status: 'error', message: missingFeed.message })
})

test('signed directory builds include the release feed the updater reads', async (t) => {
  const { mkdtemp, readFile, rm } = require('node:fs/promises')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const { default: writeUpdateConfig } = require('./update-config.cjs')
  const resources = await mkdtemp(join(tmpdir(), 'update-config-'))
  t.after(() => rm(resources, { recursive: true, force: true }))
  const packager = {
    config: { publish: { provider: 'github', owner: 'fernandobandeira', repo: 'slopbusters' } },
    appInfo: { updaterCacheDirName: '@slopbustersdesktop-updater' },
    getResourcesDir: () => resources,
  }
  await writeUpdateConfig({ electronPlatformName: 'darwin', appOutDir: 'unused', packager })
  assert.equal(
    await readFile(join(resources, 'app-update.yml'), 'utf8'),
    'owner: "fernandobandeira"\nrepo: "slopbusters"\nprovider: "github"\nupdaterCacheDirName: "@slopbustersdesktop-updater"\n',
  )
  await assert.rejects(
    writeUpdateConfig({ electronPlatformName: 'darwin', appOutDir: 'unused', packager: { ...packager, config: { publish: { provider: 'generic' } } } }),
    /Configure the GitHub release feed/,
  )
})

test('the update log rotates instead of growing without bound', async (t) => {
  const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  const { createUpdateLog } = require('../src/updateLog.cjs')
  const directory = await mkdtemp(join(tmpdir(), 'update-log-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'logs', 'updates.log')
  const log = createUpdateLog(path)
  log.error('Update failed:', new Error('dial tcp: i/o timeout'))
  assert.match(await readFile(path, 'utf8'), /\[error\] Update failed: Error: dial tcp: i\/o timeout/)
  await writeFile(path, 'x'.repeat(1024 * 1024 + 1))
  log.info('Checking for update')
  assert.equal((await stat(`${path}.old`)).size, 1024 * 1024 + 1)
  assert.match(await readFile(path, 'utf8'), /\[info\] Checking for update\n$/)
})
