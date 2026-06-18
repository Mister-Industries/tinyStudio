/**
 * LibraryManager — search/install/uninstall Arduino libraries via tinyService.
 * Opened from the library button next to the port picker in the toolbar.
 */

import { Button } from '@renderer/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@renderer/components/ui/Dialog'
import { ScrollArea } from '@renderer/components/ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/Tooltip'
import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { LibraryEntry } from '@renderer/services/arduino/types'
import { Check, Download, Library, Loader2, Package, Search, Trash2 } from 'lucide-react'
import React from 'react'
import { toast } from 'sonner'

export function LibraryManager(): React.JSX.Element {
  const { isAgentConnected, searchLibraries, listLibraries, installLibrary, uninstallLibrary } =
    useArduinoContext()

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<LibraryEntry[] | null>(null)
  const [installed, setInstalled] = React.useState<LibraryEntry[]>([])
  const [searching, setSearching] = React.useState(false)
  const [busyLib, setBusyLib] = React.useState<string | null>(null)

  const loadInstalled = React.useCallback(async () => {
    try {
      setInstalled(await listLibraries())
    } catch (e) {
      console.error('Failed to list libraries:', e)
    }
  }, [listLibraries])

  React.useEffect(() => {
    if (open && isAgentConnected) loadInstalled()
  }, [open, isAgentConnected, loadInstalled])

  const search = async (): Promise<void> => {
    if (!query.trim() || searching) return
    setSearching(true)
    setResults(null)
    try {
      setResults(await searchLibraries(query.trim()))
    } catch (e) {
      toast.error('Library search failed', {
        description: e instanceof Error ? e.message : 'Unknown error'
      })
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const install = async (name: string): Promise<void> => {
    setBusyLib(name)
    try {
      const r = await installLibrary(name)
      if (r.success) toast.success(`Installed ${name}`)
      else toast.error(`Failed to install ${name}`, { description: r.error })
      await loadInstalled()
    } finally {
      setBusyLib(null)
    }
  }

  const uninstall = async (name: string): Promise<void> => {
    setBusyLib(name)
    try {
      const r = await uninstallLibrary(name)
      if (r.success) toast.success(`Uninstalled ${name}`)
      else toast.error(`Failed to uninstall ${name}`, { description: r.error })
      await loadInstalled()
    } finally {
      setBusyLib(null)
    }
  }

  const installedNames = new Set(installed.map((l) => l.name))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="rounded-full text-fg-3 hover:text-fg-1 hover:bg-navy-500"
            >
              <Library size={18} />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Library manager</TooltipContent>
      </Tooltip>
      <DialogContent className="bg-navy-700 border border-navy-500 text-fg-1 max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Library size={18} className="text-cyan" />
            Library manager
          </DialogTitle>
        </DialogHeader>

        {!isAgentConnected ? (
          <div className="py-8 text-center text-signal-warning text-sm">
            Arduino service not connected.
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Search */}
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 bg-navy-900 border border-navy-400 rounded-lg px-3">
                <Search size={15} className="text-fg-4" />
                <input
                  className="flex-1 bg-transparent border-none outline-none py-2 text-sm text-fg-1 placeholder:text-fg-4"
                  placeholder="Search libraries — e.g. Adafruit NeoPixel, FastLED…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                />
              </div>
              <Button onClick={search} disabled={searching || !query.trim()} className="rounded-lg">
                {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              </Button>
            </div>

            {/* Results */}
            {results !== null && (
              <div>
                <div className="text-[11px] font-semibold tracking-wider text-fg-3 mb-2">
                  SEARCH RESULTS
                </div>
                <ScrollArea className="max-h-48">
                  {results.length === 0 && !searching ? (
                    <div className="text-xs text-fg-4 py-3">No libraries found.</div>
                  ) : (
                    <div className="flex flex-col gap-1 pr-2">
                      {results.map((lib) => (
                        <div
                          key={lib.name}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-navy-600"
                        >
                          <Package size={15} className="text-fg-4 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-fg-1 truncate">
                              {lib.name}{' '}
                              <span className="text-[11px] font-mono text-fg-4">{lib.version}</span>
                            </div>
                            <div className="text-xs text-fg-3 truncate">
                              {lib.sentence || lib.author}
                            </div>
                          </div>
                          {installedNames.has(lib.name) ? (
                            <Check size={16} className="text-signal-success shrink-0" />
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="rounded-lg text-xs h-7"
                              disabled={busyLib !== null}
                              onClick={() => install(lib.name)}
                            >
                              {busyLib === lib.name ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Download size={14} />
                              )}
                              Install
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}

            {/* Installed */}
            <div>
              <div className="text-[11px] font-semibold tracking-wider text-fg-3 mb-2">
                INSTALLED ({installed.length})
              </div>
              <ScrollArea className="max-h-48">
                <div className="flex flex-col gap-1 pr-2">
                  {installed.map((lib) => (
                    <div
                      key={lib.name}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-navy-600"
                    >
                      <Package size={15} className="text-signal-success shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-fg-1 truncate">
                          {lib.name}{' '}
                          <span className="text-[11px] font-mono text-fg-4">{lib.version}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 rounded-lg text-fg-3 hover:text-signal-error"
                        disabled={busyLib !== null}
                        onClick={() => uninstall(lib.name)}
                      >
                        {busyLib === lib.name ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </Button>
                    </div>
                  ))}
                  {installed.length === 0 && (
                    <div className="text-xs text-fg-4 py-3">No libraries installed yet.</div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
