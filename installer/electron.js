// electron.js — main process (Mosaic desktop app + installer)
const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { install, checkRequirements, update } = require('./scripts/install')

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

let win

// resourcesDir is where electron-builder places extraResources (the bundled
// deploy/ folder with docker-compose.yml). In dev it's the app dir; when packaged
// it's process.resourcesPath.
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : __dirname

// The app runs in one of two modes:
//   installer  — first launch (no install yet): show the install wizard.
//   app        — Mosaic is already installed: load https://localhost in-window so
//                the running app can offer a native 1-click update (Personal).
// We detect an existing install by the presence of the compose file the installer
// wrote. The mode only changes WHICH page the window loads; nothing about the
// Mosaic containers, data, or the Enterprise server-deploy path is affected.
const INSTALL_DIR = path.join(os.homedir(), 'Mosaic')
function isInstalled() {
  try { return fs.existsSync(path.join(INSTALL_DIR, 'docker-compose.yml')) } catch { return false }
}

// Trust the Caddy self-signed cert for the LOCAL app only (https://localhost). This
// is the same certificate the browser warns about; scoping the bypass to localhost
// keeps it safe (we never relax cert checks for any other origin).
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
    event.preventDefault(); callback(true)
  } else {
    callback(false)
  }
})

// Relax CSP for the local file:// installer renderer only.
app.on('session-created', (session) => {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https://localhost"]
    }})
  })
})

app.whenReady().then(() => {
  const appMode = isInstalled()
  win = new BrowserWindow({
    width: appMode ? 1200 : 780,
    height: appMode ? 820 : 620,
    resizable: true,
    center: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f0f',
    title: 'Mosaic',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (appMode) {
    // Mosaic is installed → load the running app in-window. The preload exposes
    // window.mosaicUpdater so the app's update chip can run a native 1-click update.
    win.loadURL('https://localhost')
  } else {
    win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  }
  win.once('ready-to-show', () => win.show())

  globalShortcut.register('CommandOrControl+Shift+I', () => {
    if (win) win.webContents.openDevTools({ mode: 'detach' })
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  app.quit()
})

ipcMain.handle('check-requirements', async (_, config) => checkRequirements(config || {}))

// Fire-and-forget install — progress streamed via webContents.send
ipcMain.on('start-install', (event, config) => {
  const emit = (data) => {
    if (win && !win.isDestroyed()) win.webContents.send('install-progress', data)
  }
  setImmediate(async () => {
    try {
      const result = await install({ ...config, resourcesDir: RESOURCES_DIR }, emit)
      if (win && !win.isDestroyed()) win.webContents.send('install-done', result)
    } catch (err) {
      if (win && !win.isDestroyed()) win.webContents.send('install-done', { ok: false, error: err.message })
    }
  })
})

ipcMain.handle('open-url', (_, url) => shell.openExternal(url))

// Fire-and-forget UPDATE (Personal, in app-mode): pull the new images + re-up,
// streaming progress to the running app's UpdateModal. Reuses the install helpers;
// data/volumes are untouched. After a successful update the app reloads itself.
ipcMain.on('start-update', () => {
  const emit = (data) => { if (win && !win.isDestroyed()) win.webContents.send('update-progress', data) }
  setImmediate(async () => {
    try {
      const result = await update({ installDir: INSTALL_DIR }, emit)
      if (win && !win.isDestroyed()) win.webContents.send('update-done', result)
    } catch (err) {
      if (win && !win.isDestroyed()) win.webContents.send('update-done', { ok: false, error: err.message })
    }
  })
})

ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose installation folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  return r.canceled ? null : r.filePaths[0]
})
