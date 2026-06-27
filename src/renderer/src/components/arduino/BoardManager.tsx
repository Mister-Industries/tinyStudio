/**
 * BoardManager — the toolbar board control. A dropdown lists the auto-detected
 * boards (or "No boards detected") for quick selection; its "Select another
 * board…" option opens the Boards Manager modal, which lets you override the
 * active board type, search/install/uninstall platforms (cores) from the
 * Arduino index, and manage additional board-manager URLs for third-party
 * boards.
 */

import { Button } from '@renderer/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/Dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger
} from '@renderer/components/ui/Select'
import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import {
  Board,
  BoardConfig,
  COMMON_BOARDS,
  InstallableBoard,
  PlatformEntry
} from '@renderer/services/arduino/types'
import {
  Check,
  ChevronDown,
  CircuitBoard,
  Cpu,
  Download,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Usb
} from 'lucide-react'
import React from 'react'
import { notify as toast } from '@renderer/lib/notify'

const PILL =
  'h-[30px] flex items-center gap-[7px] px-2.5 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border-[1.5px] border-[var(--border-default)] text-[13px] font-semibold text-[var(--text-strong)] hover:border-[var(--border-interactive)] transition-colors outline-none disabled:opacity-50'

const SECTION_LABEL = 'text-[11px] font-semibold tracking-wider text-fg-3 mb-2'

// Sentinel dropdown values: "no boards" placeholder and "open the manager".
const NO_BOARDS = '__none__'
const OPEN_MANAGER = '__manager__'

/** Stable Select value for a board: port + FQBN. */
function boardKey(b: Board): string {
  return `${b.port}:${b.config.fqbn}`
}

/** Build a BoardConfig from a bare FQBN (package:arch:board). */
function configFromFqbn(fqbn: string, name: string): Board['config'] {
  const [pkg, arch] = fqbn.split(':')
  return { fqbn, name, architecture: arch, package: pkg }
}

export function BoardManager(): React.JSX.Element {
  const {
    boards,
    selectedBoard,
    setSelectedBoard,
    refreshBoards,
    isLoadingBoards,
    isAgentConnected,
    searchCores,
    listCores,
    installCore,
    uninstallCore,
    listAllBoards,
    listBoardUrls,
    addBoardUrl,
    removeBoardUrl
  } = useArduinoContext()

  const [open, setOpen] = React.useState(false)

  // Platforms (cores)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<PlatformEntry[] | null>(null)
  const [installed, setInstalled] = React.useState<PlatformEntry[]>([])
  const [searching, setSearching] = React.useState(false)
  const [busyCore, setBusyCore] = React.useState<string | null>(null)

  // Board-type override
  const [allBoards, setAllBoards] = React.useState<InstallableBoard[]>([])
  const [boardFilter, setBoardFilter] = React.useState('')
  const [showOverride, setShowOverride] = React.useState(false)

  // Additional board-manager URLs
  const [urls, setUrls] = React.useState<string[]>([])
  const [newUrl, setNewUrl] = React.useState('')
  const [busyUrl, setBusyUrl] = React.useState<string | null>(null)
  const [addingUrl, setAddingUrl] = React.useState(false)

  const isConnected = isAgentConnected && selectedBoard !== null

  const loadInstalled = React.useCallback(async () => {
    try {
      setInstalled(await listCores())
    } catch (e) {
      console.error('Failed to list platforms:', e)
    }
  }, [listCores])

  const loadAllBoards = React.useCallback(async () => {
    try {
      setAllBoards(await listAllBoards())
    } catch (e) {
      console.error('Failed to list boards:', e)
    }
  }, [listAllBoards])

  const loadUrls = React.useCallback(async () => {
    try {
      setUrls(await listBoardUrls())
    } catch (e) {
      console.error('Failed to list board URLs:', e)
    }
  }, [listBoardUrls])

  React.useEffect(() => {
    if (open && isAgentConnected) {
      loadInstalled()
      loadAllBoards()
      loadUrls()
    }
  }, [open, isAgentConnected, loadInstalled, loadAllBoards, loadUrls])

  const search = async (): Promise<void> => {
    if (!query.trim() || searching) return
    setSearching(true)
    setResults(null)
    try {
      setResults(await searchCores(query.trim()))
    } catch (e) {
      toast.error('Platform search failed', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const install = async (p: PlatformEntry): Promise<void> => {
    setBusyCore(p.id)
    toast.info(`Installing ${p.name}…`, { description: 'This can take a few minutes.' })
    try {
      const r = await installCore(p.id)
      if (r.success) toast.success(`Installed ${p.name}`)
      else toast.error(`Failed to install ${p.name}`, { description: r.error })
      await Promise.all([loadInstalled(), loadAllBoards(), refreshBoards()])
    } finally {
      setBusyCore(null)
    }
  }

  const uninstall = async (p: PlatformEntry): Promise<void> => {
    setBusyCore(p.id)
    try {
      const r = await uninstallCore(p.id)
      if (r.success) toast.success(`Uninstalled ${p.name}`)
      else toast.error(`Failed to uninstall ${p.name}`, { description: r.error })
      await Promise.all([loadInstalled(), loadAllBoards()])
    } finally {
      setBusyCore(null)
    }
  }

  const addUrl = async (): Promise<void> => {
    const url = newUrl.trim()
    if (!url || addingUrl) return
    setAddingUrl(true)
    toast.info('Adding board URL…', { description: 'Refreshing the board index.' })
    try {
      const r = await addBoardUrl(url)
      if (r.success) {
        toast.success('Board URL added')
        setNewUrl('')
        await Promise.all([loadUrls(), loadInstalled()])
      } else {
        toast.error('Failed to add board URL', { description: r.error })
      }
    } finally {
      setAddingUrl(false)
    }
  }

  const removeUrl = async (url: string): Promise<void> => {
    setBusyUrl(url)
    try {
      const r = await removeBoardUrl(url)
      if (r.success) toast.success('Board URL removed')
      else toast.error('Failed to remove board URL', { description: r.error })
      await loadUrls()
    } finally {
      setBusyUrl(null)
    }
  }

  const selectDetected = (b: Board): void => {
    setSelectedBoard(b)
    toast.success(`Board set to ${b.config.name}`)
  }

  // Toolbar dropdown: pick a detected board, or open the Boards Manager.
  const handleDropdownChange = (value: string): void => {
    if (value === OPEN_MANAGER) {
      setOpen(true)
      return
    }
    if (value === NO_BOARDS) return
    const board = boards.find((b) => boardKey(b) === value)
    if (board) setSelectedBoard(board)
  }

  // Set the active board TYPE (FQBN), keeping the currently selected port.
  const selectBoardConfig = (config: BoardConfig): void => {
    setSelectedBoard({
      port: selectedBoard?.port || '',
      config,
      connected: selectedBoard?.connected ?? false
    })
    toast.success(`Board type set to ${config.name}`)
  }

  const selectFqbn = (b: InstallableBoard): void => {
    selectBoardConfig(configFromFqbn(b.fqbn, b.name))
  }

  const installedIds = new Set(installed.map((p) => p.id))
  const detectedPorts = Array.from(new Set(boards.map((b) => b.port).filter(Boolean)))

  const filteredBoards = boardFilter.trim()
    ? allBoards.filter(
        (b) =>
          b.name.toLowerCase().includes(boardFilter.toLowerCase()) ||
          b.fqbn.toLowerCase().includes(boardFilter.toLowerCase())
      )
    : allBoards

  return (
    <>
      <Select
        value={selectedBoard ? boardKey(selectedBoard) : undefined}
        onValueChange={handleDropdownChange}
        disabled={!isAgentConnected}
      >
        <SelectTrigger size="sm" className={`${PILL} [&>svg]:hidden`}>
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: isConnected ? 'var(--status-ok)' : 'var(--text-faint)' }}
          />
          <Cpu size={14} className="text-[var(--text-muted)]" />
          {selectedBoard?.config.name ? (
            <>
              {selectedBoard.config.name}
              {selectedBoard.config.architecture && (
                <span className="text-[11px] font-medium text-fg-3">
                  {selectedBoard.config.architecture}
                </span>
              )}
            </>
          ) : (
            <span className="text-fg-3 font-medium">Select board</span>
          )}
          <ChevronDown size={14} className="text-fg-4" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Detected boards</SelectLabel>
            {boards.length === 0 ? (
              <SelectItem value={NO_BOARDS} disabled>
                No boards detected
              </SelectItem>
            ) : (
              boards.map((b) => (
                <SelectItem key={boardKey(b)} value={boardKey(b)}>
                  {b.config.name || 'Unknown board'}
                  <span className="text-[11px] text-muted-foreground ml-1">{b.port}</span>
                </SelectItem>
              ))
            )}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value={OPEN_MANAGER}>Select another board…</SelectItem>
        </SelectContent>
      </Select>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircuitBoard size={18} className="text-[var(--brand)]" />
              Boards Manager
            </DialogTitle>
            <DialogDescription className="text-[var(--text-muted)]">
              Pick the active board, install board packages, and add board-manager URLs.
            </DialogDescription>
          </DialogHeader>

          {!isAgentConnected ? (
            <div className="py-8 text-center text-signal-warning text-sm">
              Arduino service not connected.
            </div>
          ) : (
            <div className="flex flex-col gap-5 min-h-0 overflow-y-auto pr-1">
              {/* Detected boards (auto-detect) */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <div className={SECTION_LABEL + ' mb-0'}>DETECTED ({detectedPorts.length})</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-lg text-xs text-fg-3"
                    disabled={isLoadingBoards}
                    onClick={() => refreshBoards()}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isLoadingBoards ? 'animate-spin' : ''}`} />
                    {isLoadingBoards ? 'Scanning…' : 'Rescan'}
                  </Button>
                </div>
                {boards.length === 0 ? (
                  <div className="text-xs text-fg-4 py-2">
                    No boards detected — plug a board in via USB and press Rescan.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {boards.map((b) => {
                      const active =
                        selectedBoard?.port === b.port &&
                        selectedBoard?.config.fqbn === b.config.fqbn
                      return (
                        <div
                          key={`${b.port}:${b.config.fqbn}`}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-sunken)]"
                        >
                          <Usb size={15} className="text-fg-4 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-fg-1 truncate">
                              {b.config.name || 'Unknown board'}{' '}
                              <span className="text-[11px] font-mono text-fg-4">{b.port}</span>
                            </div>
                            {b.config.fqbn && (
                              <div className="text-xs text-fg-3 truncate font-mono">
                                {b.config.fqbn}
                              </div>
                            )}
                          </div>
                          {active ? (
                            <span className="flex items-center gap-1 text-xs text-signal-success shrink-0">
                              <Check size={15} /> Active
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="rounded-lg text-xs h-7"
                              onClick={() => selectDetected(b)}
                            >
                              Use
                            </Button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Manual board-type override */}
              <div className="flex flex-col">
                <button
                  className="flex items-center gap-1.5 text-fg-3 hover:text-fg-1 mb-2"
                  onClick={() => setShowOverride((v) => !v)}
                >
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${showOverride ? '' : '-rotate-90'}`}
                  />
                  <span className={SECTION_LABEL + ' mb-0'}>
                    CHOOSE BOARD TYPE MANUALLY ({allBoards.length})
                  </span>
                </button>

                {/* Common boards quick-pick — fixes a misidentified board in
                    one click (e.g. a CH340 board detected as an Uno). */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {Object.values(COMMON_BOARDS).map((c) => {
                    const active = selectedBoard?.config.fqbn === c.fqbn
                    return (
                      <button
                        key={c.fqbn}
                        data-active={active}
                        onClick={() => selectBoardConfig(c)}
                        className="px-2.5 py-1 rounded-full text-xs bg-navy-900 border border-navy-400 text-fg-1 hover:bg-[var(--bg-sunken)] transition-colors data-[active=true]:border-cyan data-[active=true]:text-cyan"
                      >
                        {c.name}
                        {c.architecture && <span className="text-fg-4 ml-1">{c.architecture}</span>}
                      </button>
                    )
                  })}
                </div>

                {showOverride && (
                  <>
                    <div className="flex items-center gap-2 bg-[var(--surface-card)] border-[1.5px] border-[var(--border-default)] rounded-[var(--radius-sm)] px-3 mb-2">
                      <Search size={15} className="text-fg-4" />
                      <input
                        className="flex-1 bg-transparent border-none outline-none py-2 text-sm text-fg-1 placeholder:text-fg-4"
                        placeholder="Filter boards — e.g. Uno, ESP32-S3…"
                        value={boardFilter}
                        onChange={(e) => setBoardFilter(e.target.value)}
                      />
                    </div>
                    <div className="max-h-[28vh] overflow-y-auto flex flex-col gap-1 pr-1">
                      {filteredBoards.slice(0, 60).map((b) => {
                        const active = selectedBoard?.config.fqbn === b.fqbn
                        return (
                          <div
                            key={b.fqbn}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-sunken)]"
                          >
                            <Cpu size={15} className="text-fg-4 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-fg-1 truncate">{b.name}</div>
                              <div className="text-xs text-fg-4 truncate font-mono">{b.fqbn}</div>
                            </div>
                            {active ? (
                              <Check size={16} className="text-signal-success shrink-0" />
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-lg text-xs h-7"
                                onClick={() => selectFqbn(b)}
                              >
                                Select
                              </Button>
                            )}
                          </div>
                        )
                      })}
                      {filteredBoards.length === 0 && (
                        <div className="text-xs text-fg-4 py-2">
                          {allBoards.length === 0
                            ? 'No boards available — install a platform below.'
                            : 'No boards match your filter.'}
                        </div>
                      )}
                      {filteredBoards.length > 60 && (
                        <div className="text-[11px] text-fg-4 py-1">
                          Showing 60 of {filteredBoards.length} — refine the filter to see more.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="border-t border-[var(--border-default)]" />

              {/* Platforms (Boards Manager) */}
              <div className="flex flex-col">
                <div className={SECTION_LABEL}>INSTALL BOARD PACKAGES</div>
                <div className="flex gap-2 mb-3">
                  <div className="flex-1 flex items-center gap-2 bg-[var(--surface-card)] border-[1.5px] border-[var(--border-default)] rounded-[var(--radius-sm)] px-3">
                    <Search size={15} className="text-fg-4" />
                    <input
                      className="flex-1 bg-transparent border-none outline-none py-2 text-sm text-fg-1 placeholder:text-fg-4"
                      placeholder="Search platforms — e.g. esp32, rp2040, avr…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && search()}
                    />
                  </div>
                  <Button
                    onClick={search}
                    disabled={searching || !query.trim()}
                    className="rounded-lg"
                  >
                    {searching ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Search size={15} />
                    )}
                  </Button>
                </div>

                {results !== null && (
                  <div className="flex flex-col mb-3">
                    <div className={SECTION_LABEL}>SEARCH RESULTS</div>
                    <div className="max-h-[28vh] overflow-y-auto flex flex-col gap-1 pr-1">
                      {results.length === 0 && !searching ? (
                        <div className="text-xs text-fg-4 py-2">No platforms found.</div>
                      ) : (
                        results.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-sunken)]"
                          >
                            <CircuitBoard size={15} className="text-fg-4 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-fg-1 truncate">
                                {p.name}{' '}
                                <span className="text-[11px] font-mono text-fg-4">{p.latest}</span>
                              </div>
                              <div className="text-xs text-fg-3 truncate font-mono">{p.id}</div>
                            </div>
                            {installedIds.has(p.id) ? (
                              <Check size={16} className="text-signal-success shrink-0" />
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="rounded-lg text-xs h-7"
                                disabled={busyCore !== null}
                                onClick={() => install(p)}
                              >
                                {busyCore === p.id ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : (
                                  <Download size={14} />
                                )}
                                Install
                              </Button>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className={SECTION_LABEL}>INSTALLED PLATFORMS ({installed.length})</div>
                <div className="max-h-[28vh] overflow-y-auto flex flex-col gap-1 pr-1">
                  {installed.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-sunken)]"
                    >
                      <CircuitBoard size={15} className="text-signal-success shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-fg-1 truncate">
                          {p.name}{' '}
                          <span className="text-[11px] font-mono text-fg-4">{p.installed}</span>
                          {p.latest && p.installed && p.latest !== p.installed && (
                            <span className="text-[11px] text-signal-warning ml-1">
                              → {p.latest}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-fg-3 truncate font-mono">{p.id}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-lg text-fg-3 hover:text-signal-error"
                        disabled={busyCore !== null}
                        onClick={() => uninstall(p)}
                      >
                        {busyCore === p.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </Button>
                    </div>
                  ))}
                  {installed.length === 0 && (
                    <div className="text-xs text-fg-4 py-2">No platforms installed yet.</div>
                  )}
                </div>
              </div>

              <div className="border-t border-[var(--border-default)]" />

              {/* Additional board-manager URLs */}
              <div className="flex flex-col">
                <div className={SECTION_LABEL}>ADDITIONAL BOARD URLS ({urls.length})</div>
                <div className="flex gap-2 mb-2">
                  <div className="flex-1 flex items-center gap-2 bg-[var(--surface-card)] border-[1.5px] border-[var(--border-default)] rounded-[var(--radius-sm)] px-3">
                    <Link2 size={15} className="text-fg-4" />
                    <input
                      className="flex-1 bg-transparent border-none outline-none py-2 text-sm text-fg-1 placeholder:text-fg-4"
                      placeholder="https://…/package_…_index.json"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addUrl()}
                    />
                  </div>
                  <Button
                    onClick={addUrl}
                    disabled={addingUrl || !newUrl.trim()}
                    className="rounded-lg"
                  >
                    {addingUrl ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Plus size={15} />
                    )}
                  </Button>
                </div>
                <div className="flex flex-col gap-1">
                  {urls.map((url) => (
                    <div
                      key={url}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-sunken)]"
                    >
                      <Link2 size={14} className="text-fg-4 shrink-0" />
                      <div className="flex-1 min-w-0 text-xs text-fg-3 truncate font-mono">
                        {url}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-lg text-fg-3 hover:text-signal-error"
                        disabled={busyUrl !== null}
                        onClick={() => removeUrl(url)}
                      >
                        {busyUrl === url ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </Button>
                    </div>
                  ))}
                  {urls.length === 0 && (
                    <div className="text-xs text-fg-4 py-2">
                      No extra URLs. Add one to install third-party boards.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
