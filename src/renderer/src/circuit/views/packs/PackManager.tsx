/**
 * circuit/views/packs/PackManager — GitHub parts-pack installer UI (M2
 * leftover, spec §5.4 "Boards-Manager pattern"). See parts/packs.ts for the
 * fetch/validate/install logic and docs/tinyparts-pack-setup.md for how to
 * host an index + packs.
 *
 * Settings → Parts Libraries in spirit, but scoped into the Circuit view
 * since that's the only place parts matter today: a list of index URLs
 * (add/remove, persisted), each expanding to its packs with an
 * Install/Update button and per-part progress + failure summary.
 */

import { Download, Loader2, Package, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import {
  fetchIndex,
  fetchManifest,
  getIndexUrls,
  getInstalledPacks,
  installPack,
  setIndexUrls,
  type PackIndexEntry
} from '../../parts/packs'

interface IndexState {
  loading: boolean
  error?: string
  packs: PackIndexEntry[]
}

export function PackManager({
  onClose,
  onInstalled
}: {
  onClose: () => void
  /** a part landed in the registry — caller should re-resolve/refresh */
  onInstalled: () => void
}): React.JSX.Element {
  const [urls, setUrls] = React.useState<string[]>(() => getIndexUrls())
  const [newUrl, setNewUrl] = React.useState('')
  const [entries, setEntries] = React.useState<Record<string, IndexState>>({})
  const [installing, setInstalling] = React.useState<string | null>(null)
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null)
  const [installed, setInstalled] = React.useState(() => getInstalledPacks())

  const refreshIndex = React.useCallback((url: string) => {
    setEntries((e) => ({ ...e, [url]: { loading: true, packs: e[url]?.packs ?? [] } }))
    fetchIndex(url)
      .then((idx) => setEntries((e) => ({ ...e, [url]: { loading: false, packs: idx.packs } })))
      .catch((err) =>
        setEntries((e) => ({
          ...e,
          [url]: { loading: false, error: err instanceof Error ? err.message : String(err), packs: [] }
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
      const res = await installPack(manifest, pack.url, (done, total) => setProgress({ done, total }))
      setInstalled(getInstalledPacks())
      if (res.installed.length) onInstalled()
      if (res.failed.length) {
        toast.error(`${pack.name}: ${res.installed.length} installed, ${res.failed.length} failed`, {
          description: res.failed
            .slice(0, 4)
            .map((f) => `${f.type}: ${f.error}`)
            .join('\n')
        })
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

  const field =
    'flex-1 bg-bg-sunken border border-border-default rounded px-2 py-1.5 text-xs text-text-strong outline-none focus:border-brand'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--scrim)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[94vw] h-[560px] max-h-[90vh] bg-surface-overlay border border-border-default rounded-xl flex flex-col overflow-hidden"
        style={{ boxShadow: 'var(--shadow-soft-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
          <Package size={16} className="text-brand" />
          <span className="text-text-strong font-semibold">Parts Packs</span>
          <span className="text-[11px] text-text-muted">
            install additional components from a GitHub-hosted index
          </span>
          <div className="flex-1" />
          <button className="text-text-muted hover:text-text-strong" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-default shrink-0">
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

        <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
          {urls.length === 0 && (
            <div className="text-text-faint text-xs px-1">
              No index URLs configured. Add one above to browse installable parts packs.
            </div>
          )}
          {urls.map((url) => {
            const state = entries[url]
            return (
              <div key={url} className="rounded-lg border border-border-default overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-sunken">
                  <span className="text-[11px] text-text-muted font-mono truncate flex-1" title={url}>
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
                <div className="p-2 flex flex-col gap-1.5">
                  {!state && <div className="text-text-faint text-xs px-1">loading…</div>}
                  {state?.error && (
                    <div className="flex items-start gap-1.5 text-status-danger text-xs px-1 py-1">
                      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                      <span>{state.error}</span>
                    </div>
                  )}
                  {state && !state.error && !state.loading && state.packs.length === 0 && (
                    <div className="text-text-faint text-xs px-1">no packs listed</div>
                  )}
                  {state?.packs.map((pack) => {
                    const curVersion = installed[pack.id]
                    const isInstalling = installing === pack.id
                    const upToDate = curVersion === pack.version
                    return (
                      <div
                        key={pack.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-card border border-border-default"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-text-strong truncate">
                            {pack.name} <span className="text-text-faint font-normal">v{pack.version}</span>
                          </div>
                          {pack.description && (
                            <div className="text-[11px] text-text-muted truncate">{pack.description}</div>
                          )}
                        </div>
                        {curVersion && (
                          <span className="text-[10px] text-text-faint">
                            {upToDate ? 'installed' : `v${curVersion} installed`}
                          </span>
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
        </div>
      </div>
    </div>
  )
}
