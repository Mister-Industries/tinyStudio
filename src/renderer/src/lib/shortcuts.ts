/**
 * shortcuts: every keyboard shortcut the app defines, in one list.
 *
 * Handlers ask `matches(event, id)` instead of comparing keys themselves, and
 * the Keyboard Shortcuts dialog (components/ShortcutsDialog) and tooltips
 * render `keysOf(id)`, so the list is the one place a binding is written down.
 * Monaco's own bindings (find, comment, multi-cursor…) are not listed; only
 * what tinyStudio adds.
 *
 * "Mod" is Ctrl on Windows and Linux and ⌘ on macOS.
 */

export type ShortcutScope = 'global' | 'code' | 'circuit' | 'parts'

export interface Shortcut {
  id: string
  label: string
  scope: ShortcutScope
  /** `KeyboardEvent.key` values that trigger it; letters match either case */
  key: string | string[]
  /** needs Mod (Ctrl, or ⌘ on macOS) */
  mod?: boolean
  /** needs Shift; when absent, Shift must NOT be held */
  shift?: boolean
  /** shown instead of the derived key text ("Arrows", "Space (hold)") */
  display?: string
  /** when it applies, shown beside the label */
  when?: string
  /** an alternate binding for another entry; not listed on its own */
  hidden?: boolean
}

export const SHORTCUTS: Shortcut[] = [
  // ── everywhere ─────────────────────────────────────────────────────────────
  {
    id: 'global.shortcuts',
    label: 'Show keyboard shortcuts',
    scope: 'global',
    key: '/',
    mod: true
  },
  {
    id: 'global.save',
    label: 'Save the file',
    scope: 'global',
    key: 's',
    mod: true,
    when: 'code, circuit and visual views'
  },

  // ── code view ──────────────────────────────────────────────────────────────
  { id: 'code.closeTab', label: 'Close the tab', scope: 'code', key: 'w', mod: true },
  { id: 'code.nextTab', label: 'Next tab', scope: 'code', key: 'Tab', mod: true },
  { id: 'code.prevTab', label: 'Previous tab', scope: 'code', key: 'Tab', mod: true, shift: true },

  // ── circuit view ───────────────────────────────────────────────────────────
  {
    id: 'circuit.straightWire',
    label: 'Draw a straight wire',
    scope: 'circuit',
    key: ' ',
    display: 'Space (hold)'
  },
  {
    id: 'circuit.cancel',
    label: 'Cancel the tool, clear the selection',
    scope: 'circuit',
    key: 'Escape'
  },
  { id: 'circuit.undo', label: 'Undo', scope: 'circuit', key: 'z', mod: true },
  { id: 'circuit.redo', label: 'Redo', scope: 'circuit', key: 'y', mod: true },
  {
    id: 'circuit.redoAlt',
    label: 'Redo',
    scope: 'circuit',
    key: 'z',
    mod: true,
    shift: true,
    hidden: true
  },
  { id: 'circuit.copy', label: 'Copy', scope: 'circuit', key: 'c', mod: true, when: 'selection' },
  { id: 'circuit.cut', label: 'Cut', scope: 'circuit', key: 'x', mod: true, when: 'selection' },
  { id: 'circuit.paste', label: 'Paste', scope: 'circuit', key: 'v', mod: true },
  {
    id: 'circuit.duplicate',
    label: 'Duplicate',
    scope: 'circuit',
    key: 'd',
    mod: true,
    when: 'selection'
  },
  { id: 'circuit.rotate', label: 'Rotate', scope: 'circuit', key: 'r', when: 'parts selected' },
  {
    id: 'circuit.flip',
    label: 'Flip horizontally',
    scope: 'circuit',
    key: 'f',
    when: 'schematic, parts selected'
  },
  {
    id: 'circuit.delete',
    label: 'Delete the selection',
    scope: 'circuit',
    key: ['Delete', 'Backspace'],
    display: 'Delete'
  },
  {
    id: 'circuit.nudge',
    label: 'Nudge one grid step',
    scope: 'circuit',
    key: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    display: 'Arrows',
    when: 'parts selected'
  },
  {
    id: 'circuit.nudgeBig',
    label: 'Nudge five grid steps',
    scope: 'circuit',
    key: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    shift: true,
    display: 'Shift+Arrows',
    when: 'parts selected'
  },

  // ── parts editor ───────────────────────────────────────────────────────────
  {
    id: 'parts.nudge',
    label: 'Nudge the selected pin one art unit',
    scope: 'parts',
    key: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    display: 'Arrows'
  },
  {
    id: 'parts.nudgeGrid',
    label: 'Nudge the selected pin 0.1 in',
    scope: 'parts',
    key: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'],
    shift: true,
    display: 'Shift+Arrows'
  },
  { id: 'parts.undo', label: 'Undo', scope: 'parts', key: 'z', mod: true },
  { id: 'parts.redo', label: 'Redo', scope: 'parts', key: 'y', mod: true },
  {
    id: 'parts.redoAlt',
    label: 'Redo',
    scope: 'parts',
    key: 'z',
    mod: true,
    shift: true,
    hidden: true
  }
]

export const SCOPE_LABELS: Record<ShortcutScope, string> = {
  global: 'Everywhere',
  code: 'Code view',
  circuit: 'Circuit view',
  parts: 'Parts editor'
}

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]))

export function shortcut(id: string): Shortcut {
  const s = byId.get(id)
  if (!s) throw new Error(`Unknown shortcut: ${id}`)
  return s
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')

/** The modifier key's name on this platform. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

/** True when the event is the shortcut. Alt never takes part in a shortcut. */
export function matches(e: KeyLike, id: string): boolean {
  const s = shortcut(id)
  if (e.altKey) return false
  const mod = e.ctrlKey || e.metaKey
  if (!!s.mod !== mod) return false
  if (!!s.shift !== e.shiftKey) return false
  const keys = Array.isArray(s.key) ? s.key : [s.key]
  return keys.some((k) => (k.length === 1 ? k.toLowerCase() === e.key.toLowerCase() : k === e.key))
}

/** "Ctrl+Shift+Z" (or "⌘⇧Z" on macOS) for tooltips and the dialog. */
export function keysOf(id: string): string {
  const s = shortcut(id)
  if (s.display) return s.display.replace(/\bMod\b/g, MOD_LABEL)
  const parts: string[] = []
  if (s.mod) parts.push(MOD_LABEL)
  if (s.shift) parts.push(IS_MAC ? '⇧' : 'Shift')
  const k = Array.isArray(s.key) ? s.key[0] : s.key
  parts.push(k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k)
  return parts.join(IS_MAC ? '' : '+')
}

/** The shortcuts to list, grouped by scope in display order. */
export function shortcutsByScope(): { scope: ShortcutScope; label: string; items: Shortcut[] }[] {
  const order: ShortcutScope[] = ['global', 'code', 'circuit', 'parts']
  return order.map((scope) => ({
    scope,
    label: SCOPE_LABELS[scope],
    items: SHORTCUTS.filter((s) => s.scope === scope && !s.hidden)
  }))
}
