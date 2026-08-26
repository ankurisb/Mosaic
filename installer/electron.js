// electron.js — main process (Mosaic installer)
const { app, BrowserWindow, ipcMain, dialog, shell, globalShortcut } = require('electron')
const path = require('path')
const { install, checkRequirements } = require('./scripts/install')

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0) }

let win

// resourcesDir is where electron-builder places extraResources (the bundled
// deploy/ folder with docker-compose.yml). In dev it's the app dir; when packaged
// it's process.resourcesPath.
const RESOURCES_DIR = app.isPackaged ? process.resourcesPath : __dirname

// Relax CSP for the local file:// renderer
app.on('session-created', (session) => {
  session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:"]
    }})
  })
})

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 780, height: 620,
    resizable: false, center: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0f0f0f',
    title: 'Mosaic Installer',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
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

ipcMain.handle('choose-dir', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose installation folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  return r.canceled ? null : r.filePaths[0]
})
