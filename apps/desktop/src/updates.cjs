function createUpdates({ updater, enabled, publish }) {
  let state = { status: enabled ? 'idle' : 'disabled' }
  let busy = false
  const listeners = []
  const setState = (next) => { state = next; publish(state) }
  const on = (event, listener) => {
    updater.on(event, listener)
    listeners.push([event, listener])
  }
  updater.autoDownload = false
  updater.autoInstallOnAppQuit = false
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  on('checking-for-update', () => setState({ status: 'checking' }))
  on('update-not-available', () => setState({ status: 'idle' }))
  on('update-available', (info) => setState({ status: 'available', version: info.version }))
  on('download-progress', (progress) => setState({ ...state, status: 'downloading', percent: progress.percent }))
  on('update-downloaded', (info) => setState({ status: 'downloaded', version: info.version }))
  on('error', (error) => setState({ status: 'error', message: error.message }))

  async function perform(action) {
    if (!enabled || busy) return
    busy = true
    try { await action() }
    catch (error) { setState({ status: 'error', message: error.message || 'Update failed.' }) }
    finally { busy = false }
  }
  const check = () => ['available', 'downloading', 'downloaded'].includes(state.status)
    ? Promise.resolve() : perform(() => updater.checkForUpdates())
  const startup = enabled ? setTimeout(() => void check(), 15000) : undefined
  const polling = enabled ? setInterval(() => void check(), 4 * 60000) : undefined
  return {
    state: () => state,
    check,
    download: () => state.status === 'available' ? perform(async () => {
      setState({ ...state, status: 'downloading', percent: 0 })
      await updater.downloadUpdate()
    }) : Promise.resolve(),
    install: () => {
      if (enabled && state.status === 'downloaded') updater.quitAndInstall(false, true)
    },
    dispose: () => {
      clearTimeout(startup)
      clearInterval(polling)
      for (const [event, listener] of listeners) updater.removeListener(event, listener)
    },
  }
}
module.exports = { createUpdates }
