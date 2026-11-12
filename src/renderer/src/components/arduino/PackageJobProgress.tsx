/**
 * PackageJobProgress: what tinyService is installing right now.
 *
 * tinyService runs one package operation at a time and pushes its state
 * ("package-jobs"), with arduino-cli's download progress parsed per item. The
 * full variant sits at the top of the Boards Manager; the compact one goes in
 * the status bar so a long first-run setup is visible from anywhere.
 */

import type { PackageJob, PackageJobsState } from '@renderer/services/arduino/types'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import React from 'react'

/**
 * "esp32:esp-rv32@2601" -> "esp-rv32 2601". The platform being installed keeps
 * its full id ("tinyCore:esp32 2.0.0"), which "esp32 2.0.0" would hide.
 */
function shortItem(item: string, target?: string): string {
  const [name, version] = item.split('@')
  const bare = name === target || !name.includes(':') ? name : name.split(':').pop()
  return version ? `${bare} ${version}` : bare || item
}

function phaseLabel(job: PackageJob): string {
  const c = job.current
  if (!c) return job.done.length ? `${job.done.length} item(s) done` : 'Starting…'
  const removing = job.kind === 'core-uninstall' || job.kind === 'lib-uninstall'
  switch (c.phase) {
    case 'downloading':
      return `Downloading ${shortItem(c.item, job.target)}${c.total ? ` (${c.total})` : ''}`
    case 'configuring':
      return 'Configuring…'
    default:
      return `${removing ? 'Removing' : 'Unpacking'} ${shortItem(c.item, job.target)}`
  }
}

/** Progress bar width: the download percentage, or an indeterminate stripe. */
function Bar({ percent }: { percent?: number }): React.JSX.Element {
  return (
    <div className="h-1.5 w-full rounded-full bg-[var(--bg-sunken)] overflow-hidden">
      {percent === undefined ? (
        <div className="h-full w-1/3 rounded-full bg-[var(--brand)] animate-pulse" />
      ) : (
        <div
          className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-200"
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      )}
    </div>
  )
}

/** Full panel for the Boards Manager. Renders nothing when there is nothing to say. */
export function PackageJobPanel({
  state
}: {
  state: PackageJobsState | null
}): React.JSX.Element | null {
  if (!state) return null
  const { active, last, setup } = state

  if (active) {
    return (
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-3 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-[var(--text-strong)]">
          <Loader2 size={15} className="animate-spin text-[var(--brand)] shrink-0" />
          <span className="font-semibold truncate">{active.label}</span>
          {active.origin === 'setup' && (
            <span className="text-[11px] text-[var(--text-muted)] shrink-0">automatic setup</span>
          )}
        </div>
        <Bar
          percent={active.current?.phase === 'downloading' ? active.current.percent : undefined}
        />
        <div className="flex justify-between gap-2 text-xs text-[var(--text-muted)]">
          <span className="truncate">{phaseLabel(active)}</span>
          {active.current?.phase === 'downloading' && active.current.percent !== undefined && (
            <span className="shrink-0 tabular-nums">{Math.floor(active.current.percent)}%</span>
          )}
        </div>
        <div className="text-[11px] text-[var(--text-faint)]">
          Other installs are paused until this one finishes.
        </div>
      </div>
    )
  }

  if (setup.state === 'failed') {
    return (
      <div className="rounded-lg border border-[var(--status-warn)] p-3 text-xs flex gap-2 text-[var(--text-strong)]">
        <AlertTriangle size={15} className="text-[var(--status-warn)] shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold">{setup.message || 'Board setup did not finish'}</div>
          {setup.error && <div className="text-[var(--text-muted)] break-words">{setup.error}</div>}
        </div>
      </div>
    )
  }

  // Briefly confirm the last user-started operation's outcome.
  if (last && last.finishedAt && Date.now() - last.finishedAt < 15_000) {
    const ok = last.state === 'succeeded'
    return (
      <div className="rounded-lg border border-[var(--border-default)] p-3 text-xs flex gap-2 text-[var(--text-strong)]">
        {ok ? (
          <CheckCircle2 size={15} className="text-[var(--status-ok)] shrink-0" />
        ) : (
          <AlertTriangle size={15} className="text-[var(--status-error)] shrink-0" />
        )}
        <div className="min-w-0">
          <div className="font-semibold">
            {last.label} {ok ? 'finished' : 'failed'}
          </div>
          {!ok && last.error && (
            <div className="text-[var(--text-muted)] break-words">{last.error}</div>
          )}
        </div>
      </div>
    )
  }
  return null
}

/** One-line version for the status bar; null when idle. */
export function PackageJobStatus({
  state
}: {
  state: PackageJobsState | null
}): React.JSX.Element | null {
  const active = state?.active
  if (!active) return null
  const percent =
    active.current?.phase === 'downloading' && active.current.percent !== undefined
      ? ` ${Math.floor(active.current.percent)}%`
      : ''
  return (
    <span
      className="flex items-center gap-1.5 text-[var(--text-muted)] min-w-0"
      title={`${active.label}: ${phaseLabel(active)}`}
    >
      <Loader2 size={12} className="animate-spin shrink-0" />
      <span className="truncate">
        {active.origin === 'setup' ? 'Setting up boards: ' : ''}
        {active.label}
        {percent}
      </span>
    </span>
  )
}
