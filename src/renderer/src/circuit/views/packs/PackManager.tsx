/**
 * circuit/views/packs/PackManager — everything about where parts come from.
 *
 *   Built in       the bundled tinyparts packs, which one is serving (as
 *                  shipped / updated from GitHub / your folder), and the
 *                  "Check for updates" button (parts/tinypartsSync.ts)
 *   Developer      npm run dev only: point the app at a tinyparts checkout
 *                  (parts/devFolder.ts)
 *   This computer  local edits of shipped parts, each with Reset
 *   More packs     optional packs from an index URL: install, update, remove
 *                  (parts/packs.ts)
 *
 * docs/parts-and-art.md explains the layers behind these sections.
 */

import {
  Download,
  FolderOpen,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { PART_MANIFEST, layerGroups } from '../../../lib/partsLibrary'
import { localEdits, resetUserPart } from '../../../lib/userParts'
import { bundledPackInfo, SNAPSHOT } from '../../parts/bundled'
import {
  canChooseDevFolder,
  getDevStatus,
  onDevStatus,
  setDevFolder,
  setDevPartsEnabled,
  startDevParts
} from '../../parts/devFolder'
import {
  fetchIndex,
  fetchManifest,
  getIndexUrls,
  getInstalledPacks,
  installPack,
  isBundledPack,
  setIndexUrls,
  uninstallPack,
  type PackIndexEntry
} from '../../parts/packs'
import { listCachedPacks, type CachedPack } from '../../parts/partsCache'
import { getSyncStatus, onSyncStatus, syncTinyparts } from '../../parts/tinypartsSync'

interface IndexState {
  loading: boolean
  error?: string
  packs: PackIndexEntry[]
}

const short = (sha?: string): string => (sha ? sha.slice(0, 7) : '?')

function ago(t?: number): string {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(t).toLocaleDateString()
}

function Section({
  title,
  hint,
  action,
  children
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="shrink-0 rounded-lg border border-border-default overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-sunken">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-text-strong">{title}</div>
          {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
        </div>
        {action}
      </div>
      <div className="p-2 flex flex-col gap-1.5">{children}</div>
    </div>
  )
}

const rowCls =
  'flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-card border border-border-default'
const smallBtn =
  'h-6 px-2 rounded border border-border-default text-[11px] text-text-body hover:text-brand hover:border-brand disabled:opacity-50 flex items-center gap-1 shrink-0'

export function PackManager({
  onClose,
  onInstalled
}: {
  onClose: () => void
  /** parts changed — caller should re-resolve/refresh */
  onInstalled: () => void
}): React.JSX.Element {
  const sync = React.useSyncExternalStore(onSyncStatus, getSyncStatus)
  const dev = React.useSyncExternalStore(onDevStatus, getDevStatus)
  const [cached, setCached] = React.useState<CachedPack[]>([])
  const [urls, setUrls] = React.useState<string[]>(() => getIndexUrls())
  const [newUrl, setNewUrl] = React.useState('')
  const [entries, setEntries] = React.useState<Record<string, IndexState>>({})
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [installed, setInstalled] = React.useState(() => getInstalledPacks())
  const [edits, setEdits] = React.useState(() => localEdits())
  const builtIn = React.useMemo(() => bundledPackInfo(), [])

  const refreshCache = React.useCallback(() => {
    void listCachedPacks().then(setCached)
    setInstalled(getInstalledPacks())
    setEdits(localEdits())
  }, [])
  React.useEffect(refreshCache, [refreshCache, sync.commit, sync.state, dev.loadedAt])

  const refreshIndex = React.useCallback((url: string) => {
    setEntries((e) => ({ ...e, [url]: { loading: true, packs: e[url]?.packs ?? [] } }))
    fetchIndex(url)
      .then((idx) => setEntries((e) => ({ ...e, [url]: { loading: false, packs: idx.packs } })))
      .catch((err) =>
        setEntries((e) => ({
          ...e,
          [url]: {
            loading: false,
            error: err instanceof Error ? err.message : String(err),
            packs: []
          }
        }))
      )
  }, [])

  React.useEffect(() => {
    for (const url of urls) refreshIndex(url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addUrl = (): void => {
    const u = newUrl.trim()
    if (!u || urls.includes(u)) return
    const next = [...urls, u]
    setUrls(next)
    setIndexUrls(next)
    setNewUrl('')
    refreshIndex(u)
  }

  const removeUrl = (u: string): void => {
    const next = urls.filter((x) => x !== u)
    setUrls(next)
    setIndexUrls(next)
    setEntries((e) => {
      const n = { ...e }
      delete n[u]
      return n
    })
  }

  const install = async (pack: PackIndexEntry): Promise<void> => {
    setInstalling(pack.id)
    setProgress(null)
    try {
      const manifest = await fetchManifest(pack.url)
      const res = await installPack(manifest, pack.url, (done, total) =>
        setProgress({ done, total })
      )
      refreshCache()
      if (res.installed.length) onInstalled()
      if (res.failed.length) {
        toast.error(
          `${pack.name}: ${res.installed.length} installed, ${res.failed.length} failed`,
          {
            description: res.failed
              .slice(0, 4)
              .map((f) => `${f.type}: ${f.error}`)
              .join('\n')
          }
        )
      } else {
        toast.success(`${pack.name} v${manifest.version} installed`, {
          description: `${res.installed.length} part${res.installed.length === 1 ? '' : 's'}`
        })
      }
    } catch (err) {
      toast.error(`Couldn't install ${pack.name}`, {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setInstalling(null)
      setProgress(null)
    }
  }

  const remove = async (id: string, name: string): Promise<void> => {
    await uninstallPack(id)
    refreshCache()
    onInstalled()
    toast.success(`Removed ${name}`)
  }

  const chooseFolder = async (): Promise<void> => {
    const folder = await window.api.fs.selectFolder()
    if (!folder) return
    const ok = await window.api.fs.pathExists(`${folder}/index.json`)
    if (!ok) {
      toast.error('That folder isn’t a tinyparts checkout', {
        description: 'Pick the folder that contains index.json and packs/.'
      })
      return
    }
    await setDevFolder(folder)
    onInstalled()
  }

  const devLive = new Set(layerGroups('dev'))
  const field =
    'flex-1 bg-bg-sunken border border-border-default rounded px-2 py-1.5 text-xs text-text-strong outline-none focus:border-brand'
  const devIssues = dev.packs.flatMap((p) => [
    ...p.errors.map((e) => `✖ ${e}`),
    ...p.warnings.map((w) => `⚠ ${w}`)
  ])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--scrim)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="w-[680px] max-w-[94vw] h-[640px] max-h-[90vh] bg-surface-overlay border border-border-default rounded-xl flex flex-col overflow-hidden"
        style={{ boxShadow: 'var(--shadow-soft-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
          <Package size={16} className="text-brand" />
          <span className="text-text-strong font-semibold">Parts Packs</span>
          <span className="text-[11px] text-text-muted">where your components come from</span>
          <div className="flex-1" />
          <button className="text-text-muted hover:text-text-strong" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
          {/* ── built in ─────────────────────────────────────────────── */}
          <Section
            title="Built into tinyStudio"
            hint={
              sync.state === 'checking'
                ? `Checking ${sync.source}…`
                : sync.state === 'error'
                  ? `Update check failed: ${sync.errors[0]}`
                  : `Kept in step with github.com/${sync.source.replace('@', ' · ')} — checked ${ago(sync.checkedAt)}`
            }
            action={
              <button
                className={smallBtn}
                disabled={sync.state === 'checking'}
                onClick={() =>
                  void syncTinyparts({ force: true }).then((s) => {
                    onInstalled()
                    if (s.state === 'ok')
                      toast.success(
                        s.updated.length
                          ? `Updated: ${s.updated.join(', ')}`
                          : 'Parts are up to date',
                        { description: `tinyparts @ ${short(s.commit)}` }
                      )
                  })
                }
              >
                <RefreshCw size={11} className={sync.state === 'checking' ? 'animate-spin' : ''} />
                Check for updates
              </button>
            }
          >
            {builtIn.map((p) => {
              const c = cached.find((x) => x.id === p.id)
              const from = devLive.has(p.id)
                ? 'from your tinyparts folder'
                : c && c.origin.kind === 'github'
                  ? `updated from GitHub @ ${short(c.origin.commit)}`
                  : `as shipped @ ${short(SNAPSHOT.commit)}${SNAPSHOT.dirty ? ' (+ local changes)' : ''}`
              return (
                <div key={p.id} className={rowCls}>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-strong truncate">
                      {p.name}{' '}
                      <span className="text-text-faint font-normal">· {p.parts} parts</span>
                    </div>
                    <div className="text-[11px] text-text-muted truncate">{from}</div>
                  </div>
                </div>
              )
            })}
            {sync.errors.length > 0 && sync.state === 'ok' && (
              <div className="text-[11px] text-status-danger px-1">
                {sync.errors.slice(0, 3).join(' · ')}
              </div>
            )}
          </Section>

          {/* ── developer ────────────────────────────────────────────── */}
          {(canChooseDevFolder() || dev.serverRoot || dev.state !== 'off') && (
            <Section
              title="Developer · live tinyparts"
              hint="Parts load straight from a tinyparts checkout, and saving an .svg reloads them here. Commit + push tinyparts to share."
              action={
                canChooseDevFolder() ? (
                  <button className={smallBtn} onClick={() => void chooseFolder()}>
                    <FolderOpen size={11} /> {dev.mode === 'folder' ? 'Change…' : 'Choose folder…'}
                  </button>
                ) : undefined
              }
            >
              {!dev.folder && (
                <div className={rowCls}>
                  <div className="text-[11px] text-text-faint flex-1">
                    Off — parts come from the app and GitHub as usual.
                  </div>
                  {dev.serverRoot && (
                    <button
                      className={smallBtn}
                      title={dev.serverRoot}
                      onClick={() => void setDevPartsEnabled(true).then(onInstalled)}
                    >
                      <RefreshCw size={11} /> Turn on
                    </button>
                  )}
                </div>
              )}
              {dev.folder && (
                <div className={rowCls}>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-[11px] font-mono text-text-body truncate"
                      title={dev.folder}
                    >
                      {dev.folder}
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {dev.state === 'loading'
                        ? 'loading…'
                        : dev.state === 'error'
                          ? dev.error
                          : `${dev.mode === 'server' ? 'served by the dev server' : 'chosen folder'} · watching · ${dev.packs.map((p) => `${p.name} (${p.parts})`).join(', ')}`}
                    </div>
                  </div>
                  {window.api?.fs && (
                    <button
                      className={smallBtn}
                      onClick={() => void window.api.fs.showInFolder(`${dev.folder}/packs`)}
                    >
                      <FolderOpen size={11} /> Open
                    </button>
                  )}
                  <button
                    className={smallBtn}
                    onClick={() => void startDevParts().then(onInstalled)}
                  >
                    <RefreshCw size={11} /> Reload
                  </button>
                  <button
                    className={smallBtn}
                    onClick={() => void setDevPartsEnabled(false).then(onInstalled)}
                    title="Turn live tinyparts off (back to the built-in parts)"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}
              {devIssues.length > 0 && (
                <details className="px-1">
                  <summary className="text-[11px] text-status-warning cursor-pointer">
                    {devIssues.length} issue{devIssues.length === 1 ? '' : 's'} in the folder
                  </summary>
                  <div className="mt-1 max-h-40 overflow-y-auto text-[11px] font-mono text-text-muted whitespace-pre-wrap">
                    {devIssues.join('\n')}
                  </div>
                </details>
              )}
            </Section>
          )}

          {/* ── local edits ──────────────────────────────────────────── */}
          {edits.length > 0 && (
            <Section
              title="Edited on this computer"
              hint="These replace the shipped parts here only. Reset one to get the shipped version (and its updates) back."
            >
              {edits.map((type) => (
                <div key={type} className={rowCls}>
                  <div className="text-xs text-text-strong flex-1 truncate">
                    {PART_MANIFEST.find((m) => m.type === type)?.label ?? type}{' '}
                    <span className="text-text-faint font-mono text-[10px]">{type}</span>
                  </div>
                  <button
                    className={smallBtn}
                    onClick={() =>
                      void resetUserPart(type).then(() => {
                        setEdits(localEdits())
                        onInstalled()
                      })
                    }
                  >
                    <RotateCcw size={11} /> Reset
                  </button>
                </div>
              ))}
            </Section>
          )}

          {/* ── more packs ───────────────────────────────────────────── */}
          <Section title="More packs" hint="Optional parts, downloaded once and kept up to date.">
            <div className="flex items-center gap-2">
              <input
                className={field}
                placeholder="https://raw.githubusercontent.com/<org>/<repo>/main/index.json"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addUrl()}
              />
              <button
                className="h-7 px-2.5 rounded-md bg-brand text-white text-xs font-medium hover:bg-brand/90 flex items-center gap-1"
                onClick={addUrl}
              >
                <Plus size={13} /> Add index
              </button>
            </div>
            {urls.length === 0 && (
              <div className="text-text-faint text-xs px-1">
                No index URLs configured. Add one above to browse installable parts packs.
              </div>
            )}
            {urls.map((url) => {
              const state = entries[url]
              return (
                <div key={url} className="rounded-md border border-border-default overflow-hidden">
                  <div className="flex items-center gap-2 px-2 py-1 bg-bg-sunken">
                    <span
                      className="text-[11px] text-text-muted font-mono truncate flex-1"
                      title={url}
                    >
                      {url}
                    </span>
                    <button
                      className="text-text-faint hover:text-text-body"
                      title="Refresh"
                      onClick={() => refreshIndex(url)}
                    >
                      <RefreshCw size={12} className={state?.loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                      className="text-text-faint hover:text-status-danger"
                      title="Remove this index"
                      onClick={() => removeUrl(url)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="p-1.5 flex flex-col gap-1.5">
                    {!state && <div className="text-text-faint text-xs px-1">loading…</div>}
                    {state?.error && (
                      <div className="flex items-start gap-1.5 text-status-danger text-xs px-1 py-1">
                        <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                        <span>{state.error}</span>
                      </div>
                    )}
                    {state?.packs
                      .filter((p) => !p.bundled && !isBundledPack(p.id))
                      .map((pack) => {
                        const curVersion = installed[pack.id]
                        const c = cached.find((x) => x.id === pack.id)
                        const isInstalling = installing === pack.id
                        const upToDate = curVersion === pack.version
                        return (
                          <div key={pack.id} className={rowCls}>
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-text-strong truncate">
                                {pack.name}{' '}
                                <span className="text-text-faint font-normal">v{pack.version}</span>
                              </div>
                              {pack.description && (
                                <div className="text-[11px] text-text-muted truncate">
                                  {pack.description}
                                </div>
                              )}
                            </div>
                            {curVersion && (
                              <span className="text-[10px] text-text-faint">
                                {upToDate ? 'installed' : `v${curVersion} installed`}
                              </span>
                            )}
                            {(c || curVersion) && (
                              <button
                                className={smallBtn}
                                title="Remove this pack"
                                onClick={() => void remove(pack.id, pack.name)}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                            <button
                              className="h-6 px-2 rounded bg-brand text-white text-[11px] font-medium hover:bg-brand/90 disabled:opacity-50 flex items-center gap-1"
                              disabled={isInstalling}
                              onClick={() => void install(pack)}
                            >
                              {isInstalling ? (
                                <>
                                  <Loader2 size={11} className="animate-spin" />
                                  {progress ? `${progress.done}/${progress.total}` : '…'}
                                </>
                              ) : (
                                <>
                                  <Download size={11} />
                                  {curVersion ? (upToDate ? 'Reinstall' : 'Update') : 'Install'}
                                </>
                              )}
                            </button>
                          </div>
                        )
                      })}
                  </div>
                </div>
              )
            })}
          </Section>
        </div>
      </div>
    </div>
  )
}
