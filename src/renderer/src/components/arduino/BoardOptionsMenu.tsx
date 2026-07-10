/**
 * BoardOptionsMenu — the gear next to the board/port pickers.
 *
 * The Arduino IDE's Tools-menu equivalents, in one dialog:
 *  - Board options: the selected board's FQBN config options (PSRAM,
 *    partition scheme, CPU frequency, USB mode, …) fetched live from
 *    `arduino-cli board details`. Selections are encoded into the FQBN
 *    (`base:opt=val,opt2=val2`) exactly like the IDE does, so Verify/Upload
 *    pick them up with no other changes.
 *  - Choose board for this port: a searchable list of every installed
 *    board definition, for when auto-detection guessed wrong (VID/PID
 *    guesses are flagged) or a clone reports nothing useful.
 */

import { Button } from '@renderer/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@renderer/components/ui/Dialog'
import { IconButton } from '@renderer/components/ui/IconButton'
import { Input } from '@renderer/components/ui/Input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/Select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/Tooltip'
import { useArduinoContext } from '@renderer/contexts/ArduinoContext'
import { BoardConfigOption, BoardDetails, InstallableBoard } from '@renderer/services/arduino/types'
import { Loader2, Settings2 } from 'lucide-react'
import React, { useEffect, useMemo, useState } from 'react'

/** Split an FQBN into its base (vendor:arch:board) and option map. */
function parseFqbn(fqbn: string): { base: string; options: Record<string, string> } {
  const parts = fqbn.split(':')
  const base = parts.slice(0, 3).join(':')
  const options: Record<string, string> = {}
  if (parts.length > 3) {
    for (const pair of parts[3].split(',')) {
      const [k, v] = pair.split('=')
      if (k && v !== undefined) options[k] = v
    }
  }
  return { base, options }
}

/** Compose base + options back into an FQBN (options omitted when empty). */
function composeFqbn(base: string, options: Record<string, string>): string {
  const pairs = Object.entries(options).filter(([, v]) => v !== '')
  if (pairs.length === 0) return base
  return `${base}:${pairs.map(([k, v]) => `${k}=${v}`).join(',')}`
}

export function BoardOptionsMenu(): React.JSX.Element {
  const { selectedBoard, setSelectedBoard, boardDetails, listAllBoards, isAgentConnected } =
    useArduinoContext()
  const [open, setOpen] = useState(false)

  const fqbn = selectedBoard?.config.fqbn || ''
  const { base, options } = useMemo(() => parseFqbn(fqbn), [fqbn])

  // ── board options (FQBN config) ──────────────────────────────────────────
  const [details, setDetails] = useState<BoardDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !base || !isAgentConnected) return
    let cancelled = false
    setLoadingDetails(true)
    setDetailsError(null)
    boardDetails(base)
      .then((d) => {
        if (!cancelled) setDetails(d)
      })
      .catch((e) => {
        if (!cancelled) {
          setDetails(null)
          setDetailsError(e instanceof Error ? e.message : 'Could not load board options')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, base, isAgentConnected, boardDetails])

  /** Current value of one option: explicit in the FQBN, else the default. */
  const optionValue = (opt: BoardConfigOption): string => {
    if (options[opt.option] !== undefined) return options[opt.option]
    return opt.values.find((v) => v.selected)?.value ?? opt.values[0]?.value ?? ''
  }

  const setOption = (option: string, value: string): void => {
    if (!selectedBoard) return
    const next = composeFqbn(base, { ...options, [option]: value })
    setSelectedBoard({
      ...selectedBoard,
      config: { ...selectedBoard.config, fqbn: next }
    })
  }

  // ── choose board for this port ───────────────────────────────────────────
  const [allBoards, setAllBoards] = useState<InstallableBoard[] | null>(null)
  const [query, setQuery] = useState('')
  const [showPicker, setShowPicker] = useState(false)

  useEffect(() => {
    if (!open || !showPicker || allBoards || !isAgentConnected) return
    listAllBoards()
      .then(setAllBoards)
      .catch(() => setAllBoards([]))
  }, [open, showPicker, allBoards, isAgentConnected, listAllBoards])

  const filteredBoards = useMemo(() => {
    if (!allBoards) return []
    const q = query.trim().toLowerCase()
    const list = q
      ? allBoards.filter(
          (b) => b.name.toLowerCase().includes(q) || b.fqbn.toLowerCase().includes(q)
        )
      : allBoards
    return list.slice(0, 50)
  }, [allBoards, query])

  const pickBoard = (b: InstallableBoard): void => {
    if (!selectedBoard) return
    setSelectedBoard({
      ...selectedBoard,
      guess: false,
      config: { fqbn: b.fqbn, name: b.name }
    })
    setShowPicker(false)
    setQuery('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <IconButton
              label="Board settings"
              size="sm"
              variant="ghost"
              disabled={!isAgentConnected || !selectedBoard}
            >
              <Settings2 size={15} />
            </IconButton>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {selectedBoard ? 'Board settings & options' : 'Select a board first'}
        </TooltipContent>
      </Tooltip>

      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Board settings</DialogTitle>
        </DialogHeader>

        {selectedBoard && (
          <div className="flex flex-col gap-4">
            {/* Identity + override */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text-strong)] truncate">
                  {selectedBoard.config.name}
                  {selectedBoard.guess && (
                    <span className="ml-2 text-[11px] font-medium text-[var(--status-warn,orange)]">
                      guessed from USB id
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-[var(--text-muted)] truncate">
                  {fqbn || 'no board type'} · {selectedBoard.port}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowPicker((v) => !v)}>
                {showPicker ? 'Cancel' : 'Change board…'}
              </Button>
            </div>

            {/* Board picker (for wrong guesses / unknown clones) */}
            {showPicker && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-sm)] border-[1.5px] border-[var(--border-default)] p-2">
                <Input
                  autoFocus
                  placeholder="Search installed board definitions…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <div className="max-h-[220px] overflow-y-auto flex flex-col">
                  {allBoards === null ? (
                    <div className="flex items-center gap-2 p-2 text-xs text-[var(--text-muted)]">
                      <Loader2 size={13} className="animate-spin" /> Loading boards…
                    </div>
                  ) : filteredBoards.length === 0 ? (
                    <div className="p-2 text-xs text-[var(--text-muted)]">
                      No matches. Install the board&apos;s platform in the Boards Manager first.
                    </div>
                  ) : (
                    filteredBoards.map((b) => (
                      <button
                        key={b.fqbn}
                        onClick={() => pickBoard(b)}
                        className="text-left px-2 py-1.5 rounded hover:bg-[var(--surface-card)] transition-colors"
                      >
                        <div className="text-xs font-semibold text-[var(--text-strong)]">
                          {b.name}
                        </div>
                        <div className="text-[10px] font-mono text-[var(--text-muted)]">
                          {b.fqbn}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* FQBN config options (Tools-menu equivalents) */}
            {!showPicker && (
              <div className="flex flex-col gap-2">
                {loadingDetails ? (
                  <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Loader2 size={13} className="animate-spin" /> Loading board options…
                  </div>
                ) : detailsError ? (
                  <div className="text-xs text-[var(--text-muted)]">{detailsError}</div>
                ) : !details || details.configOptions.length === 0 ? (
                  <div className="text-xs text-[var(--text-muted)]">
                    This board exposes no configurable options.
                  </div>
                ) : (
                  details.configOptions.map((opt) => (
                    <div key={opt.option} className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-[var(--text-body)] shrink-0">
                        {opt.optionLabel}
                      </span>
                      <Select
                        value={optionValue(opt)}
                        onValueChange={(v) => setOption(opt.option, v)}
                      >
                        <SelectTrigger size="sm" className="max-w-[260px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {opt.values.map((v) => (
                              <SelectItem key={v.value} value={v.value}>
                                {v.valueLabel}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
