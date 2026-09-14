import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'

// File system API types
interface FileSystemItem {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  lastModified?: number
}

interface FileStats {
  isDirectory: boolean
  isFile: boolean
  size: number
  lastModified: number
  created: number
}

// Custom APIs for renderer
const api = {
  // File system operations
  fs: {
    // Picking a folder grants tinyStudio access to it (main/folderAccess).
    selectFolder: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('select-folder', defaultPath),
    hasAccess: (targetPath: string): Promise<boolean> =>
      ipcRenderer.invoke('has-access', targetPath),
    readDirectory: (dirPath: string, recursive = false): Promise<FileSystemItem[]> =>
      ipcRenderer.invoke('read-directory', dirPath, recursive),
    readFile: (filePath: string): Promise<string> => ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath: string, content: string): Promise<void> =>
      ipcRenderer.invoke('write-file', filePath, content),
    createFile: (filePath: string, content = ''): Promise<void> =>
      ipcRenderer.invoke('create-file', filePath, content),
    renameFile: (oldPath: string, newPath: string): Promise<void> =>
      ipcRenderer.invoke('rename-file', oldPath, newPath),
    createFolder: (folderPath: string): Promise<void> =>
      ipcRenderer.invoke('create-folder', folderPath),
    deleteFile: (targetPath: string): Promise<void> =>
      ipcRenderer.invoke('delete-file', targetPath),
    pathExists: (targetPath: string): Promise<boolean> =>
      ipcRenderer.invoke('path-exists', targetPath),
    getFileStats: (filePath: string): Promise<FileStats> =>
      ipcRenderer.invoke('get-file-stats', filePath),
    // Show a Save dialog and write the given content; returns the saved path or null.
    saveFileAs: (defaultName: string, content: string): Promise<string | null> =>
      ipcRenderer.invoke('save-file-as', defaultName, content),
    // Open a local file with the OS default app (e.g. exported HTML in a browser).
    openPath: (targetPath: string): Promise<string> => ipcRenderer.invoke('open-path', targetPath),
    // Open an external URL in the default browser.
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
    // Reveal a file or folder in Explorer / Finder.
    showInFolder: (targetPath: string): Promise<void> =>
      ipcRenderer.invoke('show-item-in-folder', targetPath)
  },

  // Parts development (npm run dev): watch a local tinyparts checkout.
  parts: {
    watch: (dir: string): Promise<void> => ipcRenderer.invoke('parts:watch', dir),
    unwatch: (): Promise<void> => ipcRenderer.invoke('parts:unwatch'),
    onChanged: (cb: (info: { dir: string; paths: string[] }) => void): (() => void) => {
      const handler = (_e: unknown, info: { dir: string; paths: string[] }): void => cb(info)
      ipcRenderer.on('parts:changed', handler)
      return () => ipcRenderer.removeListener('parts:changed', handler)
    }
  },

  // App-level paths/info.
  app: {
    // Default folder for downloaded example projects (Documents/tinyStudio Examples).
    getExamplesDir: (): Promise<string> => ipcRenderer.invoke('app:get-examples-dir'),
    // True when running unpackaged (npm run dev): parts-development features.
    isDev: (): boolean => ipcRenderer.sendSync('app:is-dev')
  },

  // Backend (tinyService) info.
  service: {
    // Real ws:// URL of the spawned backend — its port may differ from 3000.
    getUrl: (): Promise<string> => ipcRenderer.invoke('service:get-url'),
    // Synchronous variant for construction-time use: the WebSocket service
    // client is created synchronously at renderer startup, and the backend is
    // already running by then (main starts it before creating the window).
    getUrlSync: (): string => ipcRenderer.sendSync('service:get-url-sync'),
    // Whether the backend is running, and why not if it isn't.
    getStatus: (): Promise<{ running: boolean; error: string | null }> =>
      ipcRenderer.invoke('service:get-status'),
    // Stop and start the backend again on the same port.
    restart: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('service:restart'),
    // Problems main found with the backend: a crash it couldn't recover from
    // (`stopped`), or a warning such as a missing arduino-cli.
    onError: (
      cb: (info: { message: string; error: string; stopped: boolean }) => void
    ): (() => void) => {
      const handler = (
        _e: unknown,
        info: { message: string; error: string; stopped: boolean }
      ): void => cb(info)
      ipcRenderer.on('service:error', handler)
      return () => ipcRenderer.removeListener('service:error', handler)
    }
  },

  // App settings (Studio AI). The renderer never sees the API key value —
  // only whether one is configured.
  settings: {
    getStatus: (): Promise<{ configured: boolean; source: 'stored' | 'env' | 'none' }> =>
      ipcRenderer.invoke('settings:status'),
    setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('settings:set-key', key),
    clearApiKey: (): Promise<void> => ipcRenderer.invoke('settings:clear-key')
  },

  // GitHub sign-in. The device flow and the token both live in main; the
  // renderer receives the token in memory only and never persists it.
  github: {
    isConfigured: (): Promise<boolean> => ipcRenderer.invoke('github:configured'),
    getAccount: (): Promise<{
      login: string
      name: string
      avatarUrl: string
      token: string
    } | null> => ipcRenderer.invoke('github:account'),
    startDeviceFlow: (): Promise<{
      deviceCode: string
      userCode: string
      verificationUri: string
      expiresIn: number
      interval: number
    }> => ipcRenderer.invoke('github:start-device'),
    // Resolves only once the user has finished authorising on github.com.
    poll: (
      deviceCode: string,
      interval: number,
      expiresIn: number
    ): Promise<{ login: string; name: string; avatarUrl: string; token: string }> =>
      ipcRenderer.invoke('github:poll', deviceCode, interval, expiresIn),
    cancelSignIn: (): Promise<void> => ipcRenderer.invoke('github:cancel-sign-in'),
    signOut: (): Promise<void> => ipcRenderer.invoke('github:sign-out'),
    signInWithToken: (
      token: string
    ): Promise<{ login: string; name: string; avatarUrl: string; token: string }> =>
      ipcRenderer.invoke('github:sign-in-token', token)
  },

  // Studio AI agent. send() returns immediately; results stream over onEvent().
  agent: {
    send: (args: {
      text: string
      workspaceRoot: string | null
      context?: {
        board?: string
        openFile?: string
        lastError?: string
        view?: 'code' | 'circuit' | 'visual'
      }
    }): Promise<void> => ipcRenderer.invoke('agent:send', args),
    abort: (): Promise<void> => ipcRenderer.invoke('agent:abort'),
    reset: (): Promise<void> => ipcRenderer.invoke('agent:reset'),
    respondPermission: (id: string, allow: boolean): Promise<void> =>
      ipcRenderer.invoke('agent:permission-response', id, allow),
    onEvent: (cb: (evt: unknown) => void): (() => void) => {
      const handler = (_e: unknown, evt: unknown): void => cb(evt)
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    },
    onPermissionRequest: (cb: (req: unknown) => void): (() => void) => {
      const handler = (_e: unknown, req: unknown): void => cb(req)
      ipcRenderer.on('agent:permission-request', handler)
      return () => ipcRenderer.removeListener('agent:permission-request', handler)
    },
    onFileChanged: (cb: (info: { path: string }) => void): (() => void) => {
      const handler = (_e: unknown, info: { path: string }): void => cb(info)
      ipcRenderer.on('agent:file-changed', handler)
      return () => ipcRenderer.removeListener('agent:file-changed', handler)
    },
    // The agent asking the renderer for live app state (lib/studioBridge.ts).
    onStudioRequest: (cb: (req: unknown) => void): (() => void) => {
      const handler = (_e: unknown, req: unknown): void => cb(req)
      ipcRenderer.on('agent:studio-request', handler)
      return () => ipcRenderer.removeListener('agent:studio-request', handler)
    },
    respondStudio: (id: string, answer: { ok: boolean; value: string }): Promise<void> =>
      ipcRenderer.invoke('agent:studio-response', id, answer)
  }
}

// The window is always context-isolated, so the bridge is the renderer's only way in.
try {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} catch (error) {
  console.error(error)
}
