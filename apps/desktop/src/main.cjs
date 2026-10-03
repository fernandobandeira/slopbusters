const { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } = require('electron')
const { execFile } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { homedir } = require('node:os')
const { basename, delimiter, isAbsolute, join } = require('node:path')
const { promisify } = require('node:util')
const { startReviewerServer } = require('../../reviewer/server/app.ts')
const { createUpdates } = require('./updates.cjs')

const smoke = process.argv.includes('--smoke-test')
const smokeArgument = (name) => process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
function smokeStage(stage) { if (smoke) console.log(JSON.stringify({ smokeStage: stage, phase: smokeArgument('--smoke-phase') })) }
app.setName('Slopbusters')
if (smoke) {
  const directory = smokeArgument('--smoke-user-data')
  if (!directory || !isAbsolute(directory)) throw new Error('Smoke test requires an absolute data directory.')
  app.setPath('userData', directory)
}

let server
let mainWindow
let stopping = false
let quitting = false
let installing = false
let updates
const confirmedWindows = new WeakSet()
const pendingFlushes = new WeakMap()

async function confirmSaved(window) {
  if (!window || window.isDestroyed() || confirmedWindows.has(window)) return true
  if (pendingFlushes.has(window)) return pendingFlushes.get(window)
  const pending = (async () => {
    let timeout
    let approved = false
    const wasEnabled = window.isEnabled()
    // A close flush captures the current draft. Block new mouse/keyboard edits
    // until it completes or the user decides to keep the workspace open.
    window.setEnabled(false)
    try {
      await Promise.race([
        window.webContents.executeJavaScript('Promise.resolve(globalThis.slopbustersFlushReviews?.())'),
        new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Saving the review timed out.')), 10000) }),
      ])
      approved = true
      return true
    } catch (error) {
      if (smoke) throw error
      if (window.isDestroyed()) return true
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning',
        title: 'Your review could not be saved',
        message: 'Keep Slopbusters open to save your review, or close without saving the latest changes.',
        detail: error.message,
        buttons: ['Keep open', 'Close without saving'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
      approved = response === 1
      return approved
    } finally {
      clearTimeout(timeout)
      if (!window.isDestroyed()) window.setEnabled(approved ? false : wasEnabled)
    }
  })()
  pendingFlushes.set(window, pending)
  try { return await pending } finally { pendingFlushes.delete(window) }
}

async function restoreCommandPath() {
  // Finder does not inherit the PATH from a terminal. Read only PATH from the
  // user's login shell; never import or log the rest of their shell environment.
  if (process.platform !== 'darwin') return
  const loginShell = process.env.SHELL || '/bin/zsh'
  const fallback = [join(homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH || '']
  try {
    const command = basename(loginShell) === 'fish'
      ? 'printf "\\n__SLOPBUSTERS_PATH__%s" (string join : $PATH)'
      : 'printf "\\n__SLOPBUSTERS_PATH__%s" "$PATH"'
    const { stdout } = await promisify(execFile)(
      loginShell,
      ['-ilc', command],
      { timeout: 5000, maxBuffer: 1024 * 1024 },
    )
    const path = stdout.slice(stdout.lastIndexOf('__SLOPBUSTERS_PATH__') + '__SLOPBUSTERS_PATH__'.length).trim()
    if (stdout.includes('__SLOPBUSTERS_PATH__') && path && !path.includes('\n')) {
      process.env.PATH = [...new Set([...path.split(delimiter), ...fallback.flatMap((part) => part.split(delimiter))])].filter(Boolean).join(delimiter)
      return
    }
  } catch {
    // An unavailable login shell should not prevent opening the review workspace.
  }
  process.env.PATH = fallback.filter(Boolean).join(delimiter)
}

function isAppLocation(value) {
  try { return new URL(value).origin === new URL(server.url).origin } catch { return false }
}

function openExternal(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
    void shell.openExternal(url.href).catch(() => {})
  } catch {
    // Reject malformed URLs and all custom protocols.
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Slopbusters',
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 26 },
    } : {}),
    icon: join(__dirname, 'icon.png'),
    backgroundColor: '#111214',
    webPreferences: {
      partition: 'persist:slopbusters',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  })
  const contents = mainWindow.webContents
  contents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isAppLocation(url)) return
    event.preventDefault()
    openExternal(url)
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppLocation(url)) event.preventDefault()
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
  const window = mainWindow
  window.once('ready-to-show', () => { if (!smoke && !window.isDestroyed()) window.show() })
  window.on('close', (event) => {
    if (quitting || confirmedWindows.has(window)) return
    event.preventDefault()
    void confirmSaved(window).then((saved) => {
      if (!saved || window.isDestroyed()) return
      confirmedWindows.add(window)
      window.close()
    }).catch(reportFailure)
  })
  mainWindow.on('closed', () => { mainWindow = undefined })
  await mainWindow.loadURL(server.url)
  smokeStage('window-loaded')
  return mainWindow
}

async function verifySmoke(window) {
  smokeStage('runtime-check')
  // These runtime assertions run only in explicitly requested test mode.
  // Production exposes only the narrow application-update IPC bridge.
  const { DatabaseSync } = require('node:sqlite')
  const sqlite = new DatabaseSync(':memory:')
  const value = sqlite.prepare('SELECT 42 AS answer').get().answer
  sqlite.close()
  if (value !== 42) throw new Error('Electron SQLite runtime is unavailable.')
  const { getRevisionSymbols } = require('../../reviewer/server/treeSymbols.ts')
  const sourceSymbols = await getRevisionSymbols('sample.py', 'class Example:\n    def inspect(self):\n        return 42\n')
  if (!sourceSymbols.some((symbol) => symbol.kind === 'class' && symbol.name === 'Example') || !sourceSymbols.some((symbol) => symbol.name.endsWith('inspect'))) throw new Error('The bundled source parser did not load its WASM grammar.')
  smokeStage('parsers-ready')
  const phase = smokeArgument('--smoke-phase')
  const isolation = window.webContents.getLastWebPreferences()
  if (!isolation.sandbox || !isolation.contextIsolation || isolation.nodeIntegration) throw new Error('The renderer must remain sandboxed and isolated from Node.')
  if (process.platform === 'darwin') {
    const controls = window.getWindowButtonPosition()
    if (controls?.x !== 16 || controls?.y !== 26) throw new Error('The macOS window controls must use the custom title bar position.')
  }
  const result = await window.webContents.executeJavaScript(`(async () => {
    if (typeof require !== 'undefined') throw new Error('Node was exposed to the renderer.');
    const deadline = Date.now() + 10000;
    while (!document.querySelector('.app-shell main')) {
      if (Date.now() > deadline) throw new Error('The reviewer renderer did not mount.');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (document.title !== 'Slopbusters') throw new Error('The desktop app title is incorrect.');
    const titlebar = document.querySelector('.app-titlebar');
    if (!titlebar || titlebar.getBoundingClientRect().top !== 0 || getComputedStyle(titlebar).webkitAppRegion !== 'drag') throw new Error('The app title bar must be draggable and occupy the top of the window.');
    if (document.documentElement.dataset.desktopPlatform !== window.reviewerDesktop?.platform) throw new Error('The title bar platform was not exposed by the isolated preload.');
    if (window.reviewerDesktop?.platform === 'darwin' && parseFloat(getComputedStyle(titlebar).paddingLeft) < 80) throw new Error('The title bar overlaps the native macOS controls.');
    const read = async () => {
      const response = await fetch('/api/preferences');
      if (!response.ok) throw new Error('Preferences API did not load.');
      return response.json();
    };
    if (${JSON.stringify(phase)} === 'write') {
      const response = await fetch('/api/preferences', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({theme: 'solarized-dark'}),
      });
      if (!response.ok) throw new Error('Preferences API did not persist.');
    }
    const preferences = await read();
    const expectedTheme = ${JSON.stringify(phase)} === 'write' ? 'solarized-dark' : 'nord';
    if (preferences.theme !== expectedTheme) throw new Error('The theme did not persist across desktop launches.');
    return { title: document.title, theme: preferences.theme, titlebar: true, renderer: Boolean(document.querySelector('.app-shell main')) };
  })()`)
  const contextResult = phase === 'write' ? await require('./context-smoke.cjs').verifyContextRenderer(window) : {}
  await verifyUpdateFooter(window)
  smokeStage('renderer-verified')
  if (phase === 'write') await window.webContents.executeJavaScript(`(() => {
    const originalFlush = globalThis.slopbustersFlushReviews;
    globalThis.slopbustersFlushReviews = async () => {
      await originalFlush?.();
      await new Promise(resolve => setTimeout(resolve, 150));
      const response = await fetch('/api/preferences', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({theme: 'nord'}),
      });
      if (!response.ok) throw new Error('The desktop quit handshake did not persist.');
    };
  })()`)
  if (readFileSync(join(app.getPath('userData'), 'reviewer.sqlite')).subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('The persistent reviewer SQLite database was not created.')
  app.quit()
  if (window.isEnabled()) throw new Error('The window still accepts edits while the close flush is pending.')
  console.log(JSON.stringify({ smoke: phase, electron: process.versions.electron, sqlite: true, sourceParsers: true, sandbox: window.webContents.getLastWebPreferences().sandbox, closeInputBlocked: true, ...contextResult, ...result }))
}

async function verifyUpdateFooter(window) {
  const bridgeAvailable = await window.webContents.executeJavaScript(
    'typeof window.reviewerDesktop?.getUpdateState === "function"',
  )
  if (!bridgeAvailable) throw new Error('The desktop update bridge did not load.')
  for (const [state, label] of [
    [{ status: 'available', version: '99.0.0' }, 'Update available · 99.0.0'],
    [{ status: 'downloading', version: '99.0.0', percent: 42 }, 'Downloading 42%'],
    [{ status: 'downloaded', version: '99.0.0' }, 'Restart to update'],
  ]) {
    window.webContents.send('reviewer:update-state', state)
    await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const timer = setInterval(() => {
        if (document.querySelector('.app-update')?.textContent.includes(${JSON.stringify(label)})) {
          clearInterval(timer); resolve(true);
        } else if (Date.now() > deadline) {
          clearInterval(timer); reject(new Error('The update footer did not show the expected state.'));
        }
      }, 50);
    })`)
  }
  window.webContents.send('reviewer:update-state', { status: 'disabled' })
  smokeStage('update-footer-verified')
}

function registerUpdateHandlers() {
  const handle = (channel, action) => ipcMain.handle(channel, (event) => {
    if (event.sender !== mainWindow?.webContents || !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame || !isAppLocation(event.senderFrame.url))
      throw new Error('Update actions must originate from the review window.')
    return action()
  })
  handle('reviewer:update-state', () => updates.state())
  handle('reviewer:update-check', () => updates.check())
  handle('reviewer:update-download', () => updates.download())
  handle('reviewer:update-install', async () => {
    if (updates.state().status !== 'downloaded' || !mainWindow || installing || stopping) return
    const window = mainWindow
    const { response } = await dialog.showMessageBox(window, {
      type: 'question', buttons: ['Restart and install', 'Cancel'], defaultId: 0, cancelId: 1,
      message: `Install Slopbusters ${updates.state().version} and restart?`,
      detail: 'Your review will be saved first. Running organization tasks will be interrupted.',
    })
    if (response !== 0 || !(await confirmSaved(window))) return
    if (updates.state().status !== 'downloaded') {
      if (!window.isDestroyed()) window.setEnabled(true)
      return
    }
    // Squirrel's install must not be cancelled by the async quit handshake.
    // The handshake has already flushed SQLite and blocked further edits.
    installing = true
    quitting = true
    try { updates.install() }
    catch (error) {
      installing = false
      quitting = false
      if (!window.isDestroyed()) window.setEnabled(true)
      throw error
    }
  })
}

async function start() {
  smokeStage('starting')
  await restoreCommandPath()
  // Smoke fixtures exercise the local app without querying the developer's
  // authenticated GitHub account or waiting for external CLI network requests.
  if (smoke) process.env.PATH = join(app.getPath('userData'), 'no-installed-tools')
  smokeStage('path-ready')
  if (process.platform === 'darwin') app.dock?.setIcon(join(__dirname, 'icon.png'))
  const appSession = session.fromPartition('persist:slopbusters')
  appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  appSession.setPermissionCheckHandler(() => false)
  appSession.on('will-download', (event) => event.preventDefault())
  server = await startReviewerServer({
    dataDirectory: app.getPath('userData'),
    staticDirectory: join(__dirname, 'renderer'),
    sourceAssetsDirectory: join(__dirname, 'syntax'),
    port: 0,
  })
  smokeStage('server-ready')
  updates = createUpdates({
    updater: require('electron-updater').autoUpdater,
    enabled: app.isPackaged && process.platform === 'darwin' && !smoke,
    publish: (state) => {
      if (state.status === 'error' && installing) {
        installing = false
        quitting = false
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setEnabled(true)
      }
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('reviewer:update-state', state)
    },
  })
  registerUpdateHandlers()
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
  const window = await createWindow()
  if (smoke) await verifySmoke(window)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else if (server && !stopping) {
      void createWindow().catch(reportFailure)
    }
  })
  app.on('activate', () => {
    if (!server || stopping) return
    if (!mainWindow) void createWindow().catch(reportFailure)
    else mainWindow.show()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('will-quit', () => {
    updates?.dispose()
    if (installing) void server?.close().catch((error) => console.error('Reviewer shutdown failed:', error.message))
  })
  app.on('before-quit', (event) => {
    if (quitting || !server) return
    event.preventDefault()
    if (stopping) return
    stopping = true
    void (async () => {
      if (!(await confirmSaved(mainWindow))) {
        stopping = false
        return
      }
      try { await server.close() } catch (error) { console.error('Reviewer shutdown failed:', error.message) }
      quitting = true
      app.quit()
    })().catch((error) => {
      stopping = false
      console.error('Review could not be saved:', error.message)
      if (smoke) app.exit(1)
    })
  })
  void app.whenReady().then(start).catch(reportFailure)
}

function reportFailure(error) {
  console.error('Slopbusters could not start:', error.message)
  if (!smoke) dialog.showErrorBox('Slopbusters could not start', error.message)
  // Startup failures have no editable workspace to flush. Avoid opening a second
  // save dialog for a renderer that never loaded, and preserve a failure exit code.
  quitting = true
  Promise.resolve().then(() => server?.close()).catch(() => {}).finally(() => app.exit(1))
}
