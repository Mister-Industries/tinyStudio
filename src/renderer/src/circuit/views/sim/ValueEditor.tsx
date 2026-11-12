/**
 * circuit/views/sim/ValueEditor: change a part's value without leaving
 * Simulate (CircuitLab: double-click a part). A small card at the click,
 * one field per simulation attribute the part understands, committed on
 * Enter or blur; Live mode then re-solves. Esc or a click away closes it.
 */

import { X } from 'lucide-react'
import React from 'react'
import * as cmd from '../../core/commands'
import type { CircuitPart } from '../../core/model'
import { simAttrsFor } from '../../core/netlist'
import type { CircuitStore } from '../../core/store'
import { defaultAttrsFor } from '../../parts/naming'

export function ValueEditor({
  part,
  family,
  at,
  store,
  onClose
}: {
  part: CircuitPart
  family?: string
  /** viewport position of the double-click */
  at: { x: number; y: number }
  store: CircuitStore
  onClose: () => void
}): React.JSX.Element | null {
  const specs = simAttrsFor(part.type, family ?? '')
  const defaults = defaultAttrsFor(part.type)
  React.useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  // keep the card on screen
  const left = Math.min(at.x + 12, window.innerWidth - 236)
  const top = Math.min(at.y + 12, window.innerHeight - 40 - specs.length * 34)

  return (
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} />
      <div
        className="fixed z-50 w-56 rounded-md border border-border-default bg-surface-card shadow-lg p-2.5 flex flex-col gap-2"
        style={{ left, top }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-text-strong">{part.id}</span>
          <div className="flex-1" />
          <button className="text-text-faint hover:text-text-body" onClick={onClose} title="Close">
            <X size={12} />
          </button>
        </div>
        {specs.length === 0 && (
          <span className="text-[11px] text-text-faint">This part has no value to set.</span>
        )}
        {specs.map((spec, i) => {
          const value = String(part.attrs?.[spec.key] ?? defaults?.[spec.key] ?? spec.default)
          const commit = (v: string): void => {
            if (v.trim() && v !== value)
              store.dispatch(cmd.setPartAttr(part.id, spec.key, v.trim()))
          }
          return (
            <label key={spec.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-20 shrink-0 text-text-muted">{spec.label}</span>
              <input
                autoFocus={i === 0}
                className="flex-1 min-w-0 bg-bg-sunken border border-border-default rounded px-1.5 py-1 text-[12px] font-mono text-text-strong outline-none focus:border-brand"
                defaultValue={value}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commit((e.target as HTMLInputElement).value)
                    onClose()
                  }
                }}
              />
              {spec.hint && (
                <span className="text-text-faint w-6">{spec.hint.split(/\s+/)[0]}</span>
              )}
            </label>
          )
        })}
      </div>
    </>
  )
}
