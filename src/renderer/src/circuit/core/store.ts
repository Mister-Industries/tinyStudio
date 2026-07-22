/**
 * circuit/core/store — CircuitStore: document state + undo/redo + subscriptions.
 *
 * The store holds the parsed document (immutable snapshots — commands return
 * new docs with structural sharing) and an undo/redo stack of previous
 * snapshots. Because snapshots share structure, memory cost per step is the
 * delta, not a copy. Merge keys collapse drag gestures into one step.
 *
 * React binds via `useSyncExternalStore(store.subscribe, store.getRevision)`.
 * File I/O is the caller's job: `serialize()` for saves (debounce upstream),
 * `replaceFromFile()` when the file changes externally (Code-tab edits).
 */

import type { Command } from './commands'
import {
  parseCircuitFile,
  serializeDoc,
  type CircuitDoc
} from './model'

const MAX_UNDO = 200
/** Consecutive same-mergeKey commands within this window merge (ms). */
const MERGE_WINDOW = 1200

interface UndoEntry {
  doc: CircuitDoc
  label: string
  mergeKey?: string
  at: number
}

export class CircuitStore {
  private doc: CircuitDoc
  private undoStack: UndoEntry[] = []
  private redoStack: UndoEntry[] = []
  private revision = 0
  private listeners = new Set<() => void>()
  /** Last text produced by serialize()/accepted by replaceFromFile — echo guard. */
  private lastText: string | null = null

  constructor(doc: CircuitDoc) {
    this.doc = doc
  }

  static fromFile(text: string): { store: CircuitStore; migrated: boolean; warnings: string[] } {
    const { doc, migrated, warnings } = parseCircuitFile(text)
    const store = new CircuitStore(doc)
    if (!migrated) store.lastText = text
    return { store, migrated, warnings }
  }

  // ── access ────────────────────────────────────────────────────────────────

  getDoc(): CircuitDoc {
    return this.doc
  }
  /** Monotonic change counter — cheap useSyncExternalStore snapshot. */
  getRevision = (): number => this.revision

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private notify(): void {
    this.revision++
    for (const fn of this.listeners) fn()
  }

  // ── mutation ──────────────────────────────────────────────────────────────

  dispatch(cmd: Command): void {
    const next = cmd.apply(this.doc)
    if (next === this.doc) return // no-op command (guards, merges into nothing)

    const now = Date.now()
    const top = this.undoStack[this.undoStack.length - 1]
    const merged =
      cmd.mergeKey !== undefined &&
      top?.mergeKey === cmd.mergeKey &&
      now - top.at < MERGE_WINDOW

    if (!merged) {
      this.undoStack.push({ doc: this.doc, label: cmd.label, mergeKey: cmd.mergeKey, at: now })
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    } else if (top) {
      top.at = now // keep the ORIGINAL pre-gesture doc; just extend the window
    }
    this.redoStack = []
    this.doc = next
    this.notify()
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }
  canRedo(): boolean {
    return this.redoStack.length > 0
  }
  undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label
  }

  undo(): void {
    const entry = this.undoStack.pop()
    if (!entry) return
    this.redoStack.push({ doc: this.doc, label: entry.label, at: Date.now() })
    this.doc = entry.doc
    this.notify()
  }

  redo(): void {
    const entry = this.redoStack.pop()
    if (!entry) return
    this.undoStack.push({ doc: this.doc, label: entry.label, at: Date.now() })
    this.doc = entry.doc
    this.notify()
  }

  // ── file sync ─────────────────────────────────────────────────────────────

  /** Serialize the current doc; remembers the text to recognize echoes. */
  serialize(): string {
    const text = serializeDoc(this.doc)
    this.lastText = text
    return text
  }

  /**
   * The file changed outside the editor (Code tab / disk). If it's our own
   * echo, ignore. Otherwise adopt it as a new undoable state (the user can
   * undo a bad hand-edit).
   */
  replaceFromFile(text: string): { applied: boolean; warnings: string[] } {
    if (text === this.lastText) return { applied: false, warnings: [] }
    const { doc, warnings } = parseCircuitFile(text)
    this.undoStack.push({ doc: this.doc, label: 'Edit as code', at: Date.now() })
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift()
    this.redoStack = []
    this.doc = doc
    this.lastText = text
    this.notify()
    return { applied: true, warnings }
  }
}
