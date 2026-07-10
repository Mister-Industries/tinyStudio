/**
 * Minimal Arduino Language Server integration for Monaco.
 *
 * tinyService exposes the Arduino Language Server (clangd under the hood)
 * over a WebSocket bridge at /lsp — plain JSON-RPC, one payload per WS
 * message (the service handles stdio Content-Length framing). This module is
 * a deliberately small, dependency-free LSP client that wires the parts that
 * matter most into Monaco:
 *
 *   - live diagnostics (textDocument/publishDiagnostics → editor markers)
 *   - code completion  (textDocument/completion)
 *   - hover docs       (textDocument/hover)
 *   - signature help   (textDocument/signatureHelp)
 *
 * Why not monaco-languageclient? It pins specific monaco-editor versions and
 * pulls the vscode API shim; this hand-rolled client keeps the dependency
 * surface at zero and works in both the desktop and browser builds (though
 * the LS itself needs the sketch on disk, so it's desktop-only in practice).
 *
 * Everything degrades silently: if the backend closes the socket with
 * "lsp-unavailable" (binaries not installed) we remember that and stop
 * trying for the session.
 */

import type { Monaco } from '@monaco-editor/react'
import { getArduinoService } from '@renderer/services/arduino/ArduinoServiceFactory'

type MonacoEditorType = ReturnType<typeof import('monaco-editor').editor.create>

// ── tiny JSON-RPC over WebSocket ───────────────────────────────────────────

interface PendingRequest {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}

class LspConnection {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, PendingRequest>()
  private notificationHandlers = new Map<string, (params: any) => void>()
  private initialized: Promise<boolean> | null = null
  /** Documents currently open on the server: uri → version. */
  readonly openDocs = new Map<string, number>()
  disposed = false

  constructor(
    readonly url: string,
    private readonly rootUri: string
  ) {}

  /** Connect + run the LSP initialize handshake. Resolves false on failure. */
  ensureInitialized(): Promise<boolean> {
    if (!this.initialized) {
      this.initialized = this.doInitialize().catch(() => false)
    }
    return this.initialized
  }

  private doInitialize(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false
      const fail = (): void => {
        if (!settled) {
          settled = true
          resolve(false)
        }
      }
      let ws: WebSocket
      try {
        ws = new WebSocket(this.url)
      } catch {
        fail()
        return
      }
      this.ws = ws
      ws.onmessage = (ev) => this.onMessage(ev)
      ws.onclose = (ev) => {
        if (ev.reason === 'lsp-unavailable') markLspUnavailable()
        this.teardown()
        fail()
      }
      ws.onerror = () => {
        this.teardown()
        fail()
      }
      ws.onopen = async () => {
        try {
          await this.request('initialize', {
            processId: null,
            rootUri: this.rootUri,
            capabilities: {
              textDocument: {
                synchronization: { didSave: true },
                publishDiagnostics: { relatedInformation: false },
                completion: {
                  completionItem: {
                    snippetSupport: false,
                    documentationFormat: ['markdown', 'plaintext']
                  }
                },
                hover: { contentFormat: ['markdown', 'plaintext'] },
                signatureHelp: {
                  signatureInformation: { documentationFormat: ['markdown', 'plaintext'] }
                }
              },
              workspace: { configuration: false, workspaceFolders: false }
            },
            initializationOptions: {},
            workspaceFolders: null
          })
          this.notify('initialized', {})
          if (!settled) {
            settled = true
            resolve(true)
          }
        } catch {
          fail()
        }
      }
    })
  }

  request(method: string, params: unknown, timeoutMs = 15000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('LSP socket not open'))
        return
      }
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`LSP request ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer)
          resolve(r)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  notify(method: string, params: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }))
  }

  onNotification(method: string, handler: (params: any) => void): void {
    this.notificationHandlers.set(method, handler)
  }

  private onMessage(ev: MessageEvent): void {
    let msg: any
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
    } catch {
      return
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        if (msg.error) pending.reject(new Error(msg.error.message || 'LSP error'))
        else pending.resolve(msg.result)
      }
      return
    }
    if (msg.method) {
      // Server → client REQUESTS need a reply or clangd stalls; answer the
      // common ones with empty results.
      if (msg.id !== undefined) {
        this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null }))
        return
      }
      const handler = this.notificationHandlers.get(msg.method)
      if (handler) handler(msg.params)
    }
  }

  private teardown(): void {
    for (const [, p] of this.pending) p.reject(new Error('LSP connection closed'))
    this.pending.clear()
    this.openDocs.clear()
    this.ws = null
    this.initialized = null
  }

  dispose(): void {
    this.disposed = true
    try {
      this.notify('shutdown', {})
      this.ws?.close()
    } catch {
      /* already closed */
    }
    this.teardown()
  }
}

// ── module state ───────────────────────────────────────────────────────────

/** Set once the backend reports it has no language-server binaries. */
let lspUnavailable = false
function markLspUnavailable(): void {
  if (!lspUnavailable) {
    lspUnavailable = true
    console.info('[lsp] Arduino Language Server not available — code intelligence disabled')
  }
}

/** One connection per LSP URL (i.e. per FQBN); reused across editor tabs. */
const connections = new Map<string, LspConnection>()
/** Providers are registered once, globally, and resolve the connection by model URI. */
let providersRegistered = false
/** uri → connection that has the doc open (used by the global providers). */
const docConnections = new Map<string, LspConnection>()

function pathToUri(filePath: string): string {
  let p = filePath.replace(/\\/g, '/')
  if (!p.startsWith('/')) p = '/' + p // windows drive paths: /C:/…
  return 'file://' + p.split('/').map(encodeURIComponent).join('/').replace(/%3A/gi, ':')
}

function dirOf(filePath: string): string {
  const norm = filePath.replace(/\\/g, '/')
  return norm.slice(0, norm.lastIndexOf('/'))
}

function toMarkerSeverity(monaco: Monaco, lspSeverity?: number): number {
  switch (lspSeverity) {
    case 1:
      return monaco.MarkerSeverity.Error
    case 2:
      return monaco.MarkerSeverity.Warning
    case 3:
      return monaco.MarkerSeverity.Info
    default:
      return monaco.MarkerSeverity.Hint
  }
}

function hoverContentsToString(contents: any): string {
  if (!contents) return ''
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) return contents.map(hoverContentsToString).join('\n\n')
  if (typeof contents.value === 'string') return contents.value
  return ''
}

function registerProviders(monaco: Monaco): void {
  if (providersRegistered) return
  providersRegistered = true

  const connFor = (model: { uri: { toString(): string } }): LspConnection | undefined =>
    docConnections.get(model.uri.toString())

  const toLspPosition = (position: { lineNumber: number; column: number }): unknown => ({
    line: position.lineNumber - 1,
    character: position.column - 1
  })

  monaco.languages.registerCompletionItemProvider('arduino', {
    triggerCharacters: ['.', '>', ':', '_'],
    provideCompletionItems: async (model, position) => {
      const conn = connFor(model)
      if (!conn) return { suggestions: [] }
      try {
        const result: any = await conn.request('textDocument/completion', {
          textDocument: { uri: model.uri.toString() },
          position: toLspPosition(position)
        })
        const items: any[] = Array.isArray(result) ? result : (result?.items ?? [])
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn
        }
        return {
          suggestions: items.slice(0, 200).map((item) => ({
            label: item.label,
            // LSP CompletionItemKind happens to align closely with Monaco's —
            // clamp to a safe fallback (Text) when out of range.
            kind:
              item.kind && item.kind >= 1 && item.kind <= 25
                ? item.kind
                : monaco.languages.CompletionItemKind.Text,
            insertText: item.insertText || item.textEdit?.newText || item.label,
            detail: item.detail,
            documentation: item.documentation?.value ?? item.documentation,
            sortText: item.sortText,
            filterText: item.filterText,
            range
          }))
        }
      } catch {
        return { suggestions: [] }
      }
    }
  })

  monaco.languages.registerHoverProvider('arduino', {
    provideHover: async (model, position) => {
      const conn = connFor(model)
      if (!conn) return null
      try {
        const result: any = await conn.request('textDocument/hover', {
          textDocument: { uri: model.uri.toString() },
          position: toLspPosition(position)
        })
        const text = hoverContentsToString(result?.contents)
        if (!text) return null
        return { contents: [{ value: text }] }
      } catch {
        return null
      }
    }
  })

  monaco.languages.registerSignatureHelpProvider('arduino', {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp: async (model, position) => {
      const conn = connFor(model)
      if (!conn) return null
      try {
        const result: any = await conn.request('textDocument/signatureHelp', {
          textDocument: { uri: model.uri.toString() },
          position: toLspPosition(position)
        })
        if (!result?.signatures?.length) return null
        return {
          value: {
            signatures: result.signatures.map((s: any) => ({
              label: s.label,
              documentation: s.documentation?.value ?? s.documentation,
              parameters: (s.parameters ?? []).map((p: any) => ({
                label: p.label,
                documentation: p.documentation?.value ?? p.documentation
              }))
            })),
            activeSignature: result.activeSignature ?? 0,
            activeParameter: result.activeParameter ?? 0
          },
          dispose: () => {}
        }
      } catch {
        return null
      }
    }
  })
}

/**
 * Attach the language server to a mounted editor for one file. Returns a
 * detach function. Connections are cached per FQBN and shared across tabs;
 * documents are opened/closed per attach.
 */
export function attachLspToEditor(
  monaco: Monaco,
  editor: MonacoEditorType,
  filePath: string,
  fqbn: string
): (() => void) | undefined {
  if (lspUnavailable) return undefined
  const service = getArduinoService()
  const url = service.getLspUrl?.(fqbn)
  if (!url) return undefined

  registerProviders(monaco)

  let conn = connections.get(url)
  if (!conn || conn.disposed) {
    // A different FQBN means a different LS instance; drop the old ones (the
    // server compiles for exactly one board at a time).
    for (const [key, old] of connections) {
      if (key !== url) {
        old.dispose()
        connections.delete(key)
      }
    }
    conn = new LspConnection(url, pathToUri(dirOf(filePath)))
    connections.set(url, conn)
  }
  const connection = conn

  const model = editor.getModel()
  if (!model) return undefined
  const uri = model.uri.toString()
  const languageId = /\.ino$/i.test(filePath) ? 'ino' : 'cpp'

  let disposed = false
  let changeDebounce: ReturnType<typeof setTimeout> | null = null
  let contentListener: { dispose(): void } | null = null

  void connection.ensureInitialized().then((ok) => {
    if (!ok || disposed) return

    connection.onNotification('textDocument/publishDiagnostics', (params: any) => {
      try {
        const targetUri: string = params?.uri ?? ''
        const markers = (params?.diagnostics ?? []).map((d: any) => ({
          severity: toMarkerSeverity(monaco, d.severity),
          message: d.message,
          startLineNumber: (d.range?.start?.line ?? 0) + 1,
          startColumn: (d.range?.start?.character ?? 0) + 1,
          endLineNumber: (d.range?.end?.line ?? 0) + 1,
          endColumn: (d.range?.end?.character ?? 0) + 1
        }))
        for (const m of monaco.editor.getModels()) {
          if (m.uri.toString() === targetUri) {
            monaco.editor.setModelMarkers(m, 'arduino-ls', markers)
          }
        }
      } catch {
        /* diagnostics are best-effort */
      }
    })

    // didOpen (or re-sync if another tab already opened it)
    if (!connection.openDocs.has(uri)) {
      connection.openDocs.set(uri, 1)
      docConnections.set(uri, connection)
      connection.notify('textDocument/didOpen', {
        textDocument: { uri, languageId, version: 1, text: model.getValue() }
      })
    }

    // didChange — full-document sync, debounced.
    contentListener = model.onDidChangeContent(() => {
      if (changeDebounce) clearTimeout(changeDebounce)
      changeDebounce = setTimeout(() => {
        const version = (connection.openDocs.get(uri) ?? 1) + 1
        connection.openDocs.set(uri, version)
        connection.notify('textDocument/didChange', {
          textDocument: { uri, version },
          contentChanges: [{ text: model.getValue() }]
        })
      }, 250)
    })
  })

  return () => {
    disposed = true
    if (changeDebounce) clearTimeout(changeDebounce)
    contentListener?.dispose()
    // Keep the doc open on the server across tab switches (models persist in
    // Monaco too); just stop listening. Docs close implicitly when the
    // connection for a new FQBN replaces this one.
  }
}
