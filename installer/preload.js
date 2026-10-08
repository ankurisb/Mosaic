// preload.js — IPC bridge (Mosaic installer)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('installer', {
  checkRequirements: (config) => ipcRenderer.invoke('check-requirements', config),
  // Post-install deployment verification (hostname / port reachability / HTTPS).
  // Runs automatically after install (results on the install-done payload); this
  // lets the UI re-run it on demand after the operator fixes DNS / opens a port.
  verifyDeployment: (config) => ipcRenderer.invoke('verify-deployment', config),

  // Fire-and-forget install — progress via onProgress, result via onDone
  startInstall: (config) => ipcRenderer.send('start-install', config),

  onProgress: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('install-progress', handler)
    return () => ipcRenderer.removeListener('install-progress', handler)
  },

  onDone: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.once('install-done', handler)
    return () => ipcRenderer.removeListener('install-done', handler)
  },

  openUrl: (url) => ipcRenderer.invoke('open-url', url),
  enterAppMode: () => ipcRenderer.invoke('enter-app-mode'),
  chooseDir: () => ipcRenderer.invoke('choose-dir'),
  platform: process.platform,
  homeDir: require('os').homedir(),
  version: '3.0.0',
})

// In app-mode (Mosaic loaded in-window), the running app's UpdateModal uses this to
// run a native 1-click update. Absent in a plain browser, so the app falls back to
// the guided "administrator" steps — which is also the correct Enterprise behaviour.
contextBridge.exposeInMainWorld('mosaicUpdater', {
  available: true,
  update: () => ipcRenderer.send('start-update'),
  onProgress: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('update-progress', handler)
    return () => ipcRenderer.removeListener('update-progress', handler)
  },
  onDone: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.once('update-done', handler)
    return () => ipcRenderer.removeListener('update-done', handler)
  },
})
