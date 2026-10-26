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

import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'
import { PackGlyph } from '../../parts/PackGlyph'
import {
  fetchIndex,
  fetchManifest,
  getIndexUrls,
  getInstalledPacks,
  installPack,
  recordPackMeta,
  setIndexUrls,
  uninstallPack,
  type PackIndexEntry
} from '../../parts/packs'

interface IndexState {
  loading: boolean
  error?: string
  packs: PackIndexEntry[]
  /** preferred group order declared by the index */
  groups?: string[]
}

/** Bucket an index's packs under their `group`, honouring the index's declared
 * group order and falling back to alphabetical for anything unlisted. A pack
 * with no group lands in a single unnamed bucket rendered first. */
function groupPacks(
  packs: PackIndexEntry[],
  order: string[] = []
): { group: string; packs: PackIndexEntry[] }[] {
  const buckets = new Map<string, PackIndexEntry[]>()
  for (const p of packs) {
    const g = p.group || ''
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g)!.push(p)
  }
  const rank = (g: string): number => {
    if (!g) return -1
    const i = order.indexOf(g)
    return i < 0 ? order.length : i
  }
  return Array.from(buckets, ([group, list]) => ({ group, packs: list })).sort(
    (a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group)
  )
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
  const [closedGroups, setClosedGroups] = React.useState<Set<string>>(new Set())

  const refreshIndex = React.useCallback((url: string) => {
    setEntries((e) => ({ ...e, [url]: { loading: true, packs: e[url]?.packs ?? [] } }))
    fetchIndex(url)
      .then((idx) => {
        // Refresh the display metadata we hold for packs already installed.
        // Name, icon and group are presentation, not content — when the index
        // starts shipping real tab artwork instead of a two-letter monogram,
        // an installed pack should pick it up on the next look at this panel
        // rather than only after a reinstall.
        const have = getInstalledPacks()
        for (const p of idx.packs) {
          const cur = have[p.id]
          if (!cur) continue
          if (cur.name === p.name && cur.icon === p.icon && cur.group === p.group) continue
          recordPackMeta({ ...cur, name: p.name, icon: p.icon, group: p.group })
        }
        setInstalled(getInstalledPacks())
        setEntries((e) => ({
          ...e,
          [url]: { loading: false, packs: idx.packs, groups: idx.groups }
        }))
      })
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
      setInstalled(getInstalledPacks())
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

  const uninstall = async (pack: PackIndexEntry): Promise<void> => {
    setInstalling(pack.id)
    try {
      const n = await uninstallPack(pack.id)
      setInstalled(getInstalledPacks())
      onInstalled()
      toast.success(`${pack.name} removed`, {
        description: `${n} part${n === 1 ? '' : 's'} deleted`
      })
    } catch (err) {
      toast.error(`Couldn't remove ${pack.name}`, {
        description: err instanceof Error ? err.message : String(err)
      })
    } finally {
      setInstalling(null)
    }
  }

  // group collapse state, keyed "<indexUrl>\n<group>"; groups start open
  const isGroupOpen = (url: string, group: string): boolean => !closedGroups.has(`${url}\n${group}`)
  const toggleGroup = (url: string, group: string): void =>
    setClosedGroups((s) => {
      const key = `${url}\n${group}`
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

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
                  {state &&
                    groupPacks(state.packs, state.groups).map(({ group, packs }) => (
                      <div key={group || '_'} className="flex flex-col gap-1.5">
                        {group && (
                          <button
                            className="flex items-center gap-1 px-1 pt-1 text-[11px] font-semibold text-text-muted hover:text-text-body"
                            onClick={() => toggleGroup(url, group)}
                          >
                            {isGroupOpen(url, group) ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                            <span>{group}</span>
                            <span className="text-text-faint/70 font-normal">
                              {packs.length} pack{packs.length === 1 ? '' : 's'} ·{' '}
                              {packs.reduce((n, p) => n + (p.count ?? 0), 0)} parts
                            </span>
                          </button>
                        )}
                        {(!group || isGroupOpen(url, group)) &&
                          packs.map((pack) => {
                            const cur = installed[pack.id]
                            const isInstalling = installing === pack.id
                            const upToDate = cur?.version === pack.version
                            return (
                              <div
                                key={pack.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-card border border-border-default"
                              >
                                <span
                                  className="w-7 h-7 shrink-0 grid place-items-center rounded bg-bg-sunken text-text-muted"
                                  aria-hidden
                                >
                                  <PackGlyph icon={pack.icon} size={20} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium text-text-strong truncate">
                                    {pack.name}{' '}
                                    <span className="text-text-faint font-normal">
                                      v{pack.version}
                                      {pack.count != null ? ` · ${pack.count} parts` : ''}
                                    </span>
                                  </div>
                                  {pack.description && (
                                    <div className="text-[11px] text-text-muted truncate">
                                      {pack.description}
                                    </div>
                                  )}
                                </div>
                                {cur && (
                                  <span className="text-[10px] text-text-faint shrink-0">
                                    {upToDate ? 'installed' : `v${cur.version} installed`}
                                  </span>
                                )}
                                {cur && (
                                  <button
                                    className="h-6 w-6 shrink-0 grid place-items-center rounded text-text-faint hover:text-status-danger disabled:opacity-40"
                                    title="Uninstall — removes this pack's parts"
                                    disabled={isInstalling}
                                    onClick={() => void uninstall(pack)}
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                                <button
                                  className="h-6 px-2 shrink-0 rounded bg-brand text-white text-[11px] font-medium hover:bg-brand/90 disabled:opacity-50 flex items-center gap-1"
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
                                      {cur ? (upToDate ? 'Reinstall' : 'Update') : 'Install'}
                                    </>
                                  )}
                                </button>
                              </div>
                            )
                          })}
                      </div>
                    ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
