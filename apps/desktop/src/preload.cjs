const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('reviewerDesktop', {
  platform: process.platform,
  getUpdateState: () => ipcRenderer.invoke('reviewer:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('reviewer:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('reviewer:update-download'),
  installUpdate: () => ipcRenderer.invoke('reviewer:update-install'),
  onUpdateState(listener) {
    const receive = (_event, state) => listener(state)
    ipcRenderer.on('reviewer:update-state', receive)
    return () => ipcRenderer.removeListener('reviewer:update-state', receive)
  },
})
