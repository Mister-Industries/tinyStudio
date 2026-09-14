import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import icon from '../../resources/icon.png?asset'
import { AgentService, type AgentSendArgs } from './AgentService'
import { openExternalSafely } from './externalLinks'
import {
  cancelSignIn as ghCancelSignIn,
  getAccount as ghGetAccount,
  isConfigured as ghIsConfigured,
  pollForToken as ghPollForToken,
  signInWithToken as ghSignInWithToken,
  signOut as ghSignOut,
  startDeviceFlow as ghStartDeviceFlow
} from './githubAuth'
import { registerFileIpc } from './ipc/files'
import { registerPartsIpc } from './ipc/parts'
import { registerWindowIpc } from './ipc/window'
import { ServiceManager } from './ServiceManager'
import { clearApiKey, getStatus, setApiKey } from './settings'
import { TINYSERVICE_DEFAULT_PORT } from '../shared/tinyservice'

const serviceManager = new ServiceManager({
  port: TINYSERVICE_DEFAULT_PORT,
  // The desktop renderer, the dev server and the hosted web app. tinyService
  // 1.1.0 doesn't check the WebSocket Origin header yet; this list takes
  // effect once it does.
  allowedOrigins: ['file://', 'http://localhost:5173', 'https://app.tinystudio.cc']
})

// Studio AI agent — one instance, bound to the main window.
const agentService = new AgentService()

/** The URL the renderer is served from, so navigation elsewhere can be refused. */
const rendererUrl =
  is.dev && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : pathToFileURL(join(__dirname, '../renderer/index.html')).href

function isAppUrl(url: string): boolean {
  try {
    const target = new URL(url)
    const appUrl = new URL(rendererUrl)
    if (target.protocol !== appUrl.protocol) return false
    return target.protocol === 'file:'
      ? target.pathname === appUrl.pathname
      : target.host === appUrl.host
  } catch {
    return false
  }
}

function createWindow(): void {
  // Size to fit the monitor: cap the window to the available work area so the
  // bottom is never cut off on smaller / lower-resolution screens.
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const winW = Math.min(1280, screenW - 40)
  const winH = Math.min(800, screenH - 40)

  const mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 900,
    minHeight: 560,
    center: true,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  serviceManager.setMainWindow(mainWindow)
  agentService.setWindow(mainWindow)

  mainWindow.on('ready-to-show', () => mainWindow.show())
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized'))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:unmaximized'))

  // Links open in the user's browser. The app window only ever shows the app:
  // a plain link click in a README must not replace it with a website that has
  // no way back (the window is frameless).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return
    event.preventDefault()
    void openExternalSafely(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Matches appId in electron-builder.yml; Windows groups taskbar icons and
  // notifications by it.
  electronApp.setAppUserModelId('cc.tinystudio.app')

  // Register standard edit/view accelerators (undo/redo/cut/copy/paste/select-all,
  // reload, devtools). The window is frameless so this menu stays hidden, but
  // without it those shortcuts never bind — e.g. Ctrl+Z wouldn't work in inputs.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
  )

  try {
    await serviceManager.start()
  } catch (error) {
    console.error('Failed to start TinyService during app initialization:', error)
  }

  // F12 toggles DevTools in development; Ctrl/Cmd+R is ignored in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // The backend may bind to a non-default port (3000 can be taken by another
  // dev server); the renderer asks for the real URL instead of assuming.
  ipcMain.handle('service:get-url', () => serviceManager.getServiceUrl())
  ipcMain.on('service:get-url-sync', (event) => {
    event.returnValue = serviceManager.getServiceUrl()
  })

  // --- Studio AI agent + settings ---
  ipcMain.handle('settings:status', () => getStatus())
  ipcMain.handle('settings:set-key', (_, key: string) => setApiKey(key))
  ipcMain.handle('settings:clear-key', () => clearApiKey())

  // Fire-and-forget: the agent streams its work back over 'agent:event'.
  ipcMain.handle('agent:send', (_, args: AgentSendArgs) => {
    void agentService.send(args)
  })
  ipcMain.handle('agent:abort', () => agentService.abort())
  ipcMain.handle('agent:reset', () => agentService.reset())
  ipcMain.handle('agent:permission-response', (_, id: string, allow: boolean) => {
    agentService.resolvePermission(id, allow)
  })
  ipcMain.handle(
    'agent:studio-response',
    (_, id: string, answer: { ok: boolean; value: string }) => {
      agentService.resolveStudio(id, answer)
    }
  )

  // --- GitHub sign-in (OAuth device flow) ---
  // These live in main because GitHub's OAuth endpoints send no CORS headers, so
  // the renderer cannot call them — and because the token is then stored with
  // safeStorage instead of sitting in renderer localStorage.
  ipcMain.handle('github:configured', () => ghIsConfigured())
  ipcMain.handle('github:account', () => ghGetAccount())
  ipcMain.handle('github:start-device', () => ghStartDeviceFlow())
  // Long-running on purpose: resolves once the user finishes on github.com.
  ipcMain.handle('github:poll', (_, deviceCode: string, interval: number, expiresIn: number) =>
    ghPollForToken(deviceCode, interval, expiresIn)
  )
  ipcMain.handle('github:cancel-sign-in', () => ghCancelSignIn())
  ipcMain.handle('github:sign-out', () => ghSignOut())
  ipcMain.handle('github:sign-in-token', (_, token: string) => ghSignInWithToken(token))

  // Unpackaged (npm run dev / npm start): unlocks parts-development features.
  ipcMain.on('app:is-dev', (event) => {
    event.returnValue = is.dev
  })

  registerWindowIpc()
  registerFileIpc()
  registerPartsIpc()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS, where apps stay active
// until the user quits with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Stop TinyService before the app quits
app.on('before-quit', async (event) => {
  if (serviceManager.isServiceRunning()) {
    event.preventDefault()

    // Force exit after timeout if cleanup hangs
    const cleanupTimeout = setTimeout(() => {
      console.error('Cleanup timeout - forcing exit')
      app.exit(0)
    }, 3000)

    try {
      await serviceManager.stop()
      clearTimeout(cleanupTimeout)
      app.exit()
    } catch (error) {
      console.error('Error stopping TinyService during app quit:', error)
      clearTimeout(cleanupTimeout)
      app.exit(1)
    }
  }
})
