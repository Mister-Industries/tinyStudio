/**
 * PartsEditor: a top-level modal for authoring or editing a part. Upload an SVG
 * (or start from a blank box), set its size, then click on the preview to drop
 * pins and drag them into place. Pins are saved in the same schema as every
 * other part (pixel coords @ 96 DPI), so a hand-made part wires up exactly like
 * a shipped one.
 *
 * Pins can also come straight from the art: any shape whose id is `pin-<NAME>`
 * becomes a pin (name the object "pin-GND" in Illustrator). Uploading such an
 * SVG fills the pin list, and as long as you don't drag them the part keeps
 * reading pins from its file, so later art edits move the pins too.
 *
 * Where a save goes (docs/parts-and-art.md):
 *   - "Save on this computer": a local copy that shadows the shipped part here
 *     only; "Reset to default" throws it away.
 *   - "Save to tinyparts" (npm run dev with a tinyparts folder set): writes
 *     part.json and the .svg files into the checkout; commit + push to share.
 *
 * Both views are editable via the toggle; each keeps its own art, size and pin
 * positions (pin NAMES are the cross-view join key, so keep them consistent).
 *
 * The Schematic view has a second mode, **Symbol** (components/SymbolEditor):
 * a body shape, a name and pins on the 0.1 in grid, rendered to a schematic
 * SVG with `pin-*` shapes (circuit/parts/symbolDraft), so it saves and loads
 * exactly like hand-drawn art. Saving overwrites the part's schematic.svg.
 *
 * Arrow keys nudge the selected pin by one unit of the art's own coordinates
 * (Shift: 0.1 in). While the pins come from `pin-*` shapes, a nudge moves the
 * shape in the SVG itself, so the file stays the source of truth; only a drag
 * pins the positions down in part.json. Ctrl+Z / Ctrl+Y undo and redo every
 * pin, size and art change.
 */

import { FolderOpen, Plus, RotateCcw, Trash2, UploadCloud, X } from 'lucide-react'
import React from 'react'
import type { PartDef, PartSource, PartView, ViewKind } from '../lib/partsLibrary'
import { GRID_BB } from '../circuit/core/model'
import { keysOf, matches } from '../lib/shortcuts'
import {
  artPrefix,
  movePinInArt,
  namespaceSvg,
  prepareArt,
  readSvgRoot,
  scanPins
} from '../circuit/parts/svgArt'
import { sanitizeSvg } from '../lib/sanitizeSvg'
import {
  draftFromPins,
  draftFromView,
  renderDraft,
  type SymbolDraft
} from '../circuit/parts/symbolDraft'
import { SymbolCanvas, SymbolPanel } from './SymbolEditor'

const slug = (s: string): string =>
  s
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'custom-part'

interface Pin {
  name: string
  x: number
  y: number
}

interface ViewBuf {
  /** what the preview draws (namespaced for this modal) */
  svg: string
  /** the art file exactly as authored, when there is one */
  raw?: string
  w: number
  h: number
  pins: Pin[]
  /** pins were read from pin-* ids in the art */
  fromSvg: boolean
  pinsEdited: boolean
  sizeEdited: boolean
  artChanged: boolean
}

/** Everything a save needs beyond the definition itself. */
export interface PartsEditorSaveInfo {
  /** authored art per view, for views whose file must be (re)written */
  art: Partial<Record<ViewKind, string>>
  pinMode: Partial<Record<ViewKind, 'svg' | 'fixed'>>
  sizeEdited: Partial<Record<ViewKind, boolean>>
  labelEdited: boolean
}

const blankSvg = (w: number, h: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="4" fill="#383A40" stroke="#4A4D54"/></svg>`

const previewOf = (raw: string, kind: ViewKind): string =>
  namespaceSvg(prepareArt(raw), artPrefix(`editor-${kind}`))

function seedView(
  v: PartView | undefined,
  kind: ViewKind,
  source: PartSource | undefined,
  fallbackW = 80,
  fallbackH = 40
): ViewBuf {
  if (!v) {
    const raw = blankSvg(fallbackW, fallbackH)
    return {
      svg: raw,
      raw,
      w: fallbackW,
      h: fallbackH,
      pins: [],
      fromSvg: false,
      pinsEdited: false,
      sizeEdited: false,
      artChanged: false
    }
  }
  return {
    svg: v.svg,
    raw: source?.raw?.[kind],
    w: v.w,
    h: v.h,
    pins: Object.entries(v.pins).map(([n, [x, y]]) => ({ name: n, x, y })),
    fromSvg: !!source?.pinsFromSvg?.[kind],
    pinsEdited: false,
    sizeEdited: false,
    artChanged: false
  }
}

function describeSource(def: PartDef | null | undefined, localEdit: boolean): string {
  if (!def) return 'new part'
  const s = def.source
  const where = s?.dir ? `tinyparts/${s.dir}` : s?.pack ? `tinyparts pack “${s.pack}”` : ''
  if (localEdit) return 'edited on this computer'
  switch (s?.layer) {
    case 'dev':
      return `from your tinyparts folder · ${where}`
    case 'remote':
      return `updated from GitHub · ${where}`
    case 'bundled':
      return `ships with tinyStudio · ${where}`
    case 'user':
      return 'saved on this computer'
    default:
      return 'built in'
  }
}

export function PartsEditor({
  initial,
  onClose,
  onSave,
  onSaveToFolder,
  folderPacks,
  localEdit = false,
  onReset
}: {
  initial?: PartDef | null
  onClose: () => void
  /** save on this computer only */
  onSave: (def: PartDef, info: PartsEditorSaveInfo) => void | Promise<void>
  /** dev only: write into the tinyparts checkout, in `pack` */
  onSaveToFolder?: (def: PartDef, info: PartsEditorSaveInfo, pack: string) => void | Promise<void>
  /** dev only: packs in the checkout a new part could go into */
  folderPacks?: { id: string; name: string }[]
  /** `initial` is a local edit shadowing a shipped part */
  localEdit?: boolean
  onReset?: () => void | Promise<void>
}): React.JSX.Element {
  const [name, setName] = React.useState(initial?.label || 'My Part')
  const [bb, setBb] = React.useState<ViewBuf>(() =>
    seedView(initial?.views.breadboard, 'breadboard', initial?.source)
  )
  const [sch, setSch] = React.useState<ViewBuf>(() =>
    seedView(initial?.views.schematic, 'schematic', initial?.source)
  )
  const [editView, setEditView] = React.useState<ViewKind>(
    initial && !initial.views.breadboard && initial.views.schematic ? 'schematic' : 'breadboard'
  )
  const [sel, setSel] = React.useState<number>(-1)
  const [busy, setBusy] = React.useState(false)
  // Symbol mode: the draft is the truth; every change re-renders the
  // schematic art from it. null until the mode is entered.
  const [schMode, setSchMode] = React.useState<'art' | 'symbol'>('art')
  const [draft, setDraft] = React.useState<SymbolDraft | null>(null)
  const [targetPack, setTargetPack] = React.useState<string>(
    initial?.source?.pack ??
      folderPacks?.find((p) => p.id === 'core')?.id ??
      folderPacks?.[0]?.id ??
      ''
  )
  const surfaceRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<number>(-1)

  const buf = editView === 'breadboard' ? bb : sch
  const setBuf = editView === 'breadboard' ? setBb : setSch
  const { svg, w, h, pins } = buf

  // Undo history: whole-editor snapshots taken before each change (a drag
  // records once, at pointer-down). Kept in a ref so recording never re-renders.
  interface Snap {
    bb: ViewBuf
    sch: ViewBuf
    editView: ViewKind
    sel: number
    draft: SymbolDraft | null
  }
  const history = React.useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] })
  const record = (): void => {
    const h = history.current
    h.past.push({ bb, sch, editView, sel, draft })
    if (h.past.length > 100) h.past.shift()
    h.future = []
  }
  const restore = (s: Snap): void => {
    setBb(s.bb)
    setSch(s.sch)
    setEditView(s.editView)
    setSel(s.sel)
    setDraft(s.draft)
  }
  const undo = (): void => {
    const h = history.current
    const s = h.past.pop()
    if (!s) return
    h.future.push({ bb, sch, editView, sel, draft })
    restore(s)
  }
  const redo = (): void => {
    const h = history.current
    const s = h.future.pop()
    if (!s) return
    h.past.push({ bb, sch, editView, sel, draft })
    restore(s)
  }

  // ── Symbol mode ──────────────────────────────────────────────────────────
  /** Turn the draft into the schematic view's art and pins. */
  const applyDraft = (next: SymbolDraft): void => {
    const r = renderDraft(next)
    setDraft(next)
    setSch((b) => ({
      ...b,
      raw: r.svg,
      svg: previewOf(r.svg, 'schematic'),
      w: r.w,
      h: r.h,
      pins: Object.entries(r.pins).map(([n, [x, y]]) => ({ name: n, x, y })),
      fromSvg: true,
      pinsEdited: false,
      artChanged: true,
      sizeEdited: true
    }))
  }
  /** The generated-box layout over the part's pins (breadboard names first). */
  const draftFromBox = (): SymbolDraft =>
    draftFromPins(
      (bb.pins.length ? bb.pins : sch.pins).map((p) => p.name),
      name
    )
  const enterSymbolMode = (): void => {
    setSchMode('symbol')
    setSel(-1)
    if (!draft) {
      record()
      applyDraft(draftFromBox())
    }
  }
  const changeDraft = (next: SymbolDraft, commit = true): void => {
    if (commit) record()
    applyDraft(next)
  }

  // any hand change to pins pins them down in part.json from then on
  const setPins = (fn: (ps: Pin[]) => Pin[]): void =>
    setBuf((b) => ({ ...b, pins: fn(b.pins), pinsEdited: true }))

  const switchView = (v: ViewKind): void => {
    if (v === editView) return
    setEditView(v)
    setSel(-1)
  }
  // Editing the art file directly leaves Symbol mode: the two would fight
  // over sch.raw.
  const onUploadArt = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setSchMode('art')
    onUpload(e)
  }

  // fit the part into the preview area (cap zoom so tiny parts stay visible)
  const scale = Math.min(440 / w, 320 / h, 14)

  const uniqueName = (base: string, skip = -1): string => {
    let n = base
    let i = 1
    while (pins.some((p, idx) => idx !== skip && p.name === n)) n = `${base}.${i++}`
    return n
  }

  const surfacePoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = surfaceRef.current!.getBoundingClientRect()
    return {
      x: Math.round(Math.max(0, Math.min(w, (e.clientX - r.left) / scale))),
      y: Math.round(Math.max(0, Math.min(h, (e.clientY - r.top) / scale)))
    }
  }

  const onSurfaceClick = (e: React.MouseEvent): void => {
    if ((e.target as HTMLElement).closest('.editor-pin')) return
    const p = surfacePoint(e)
    record()
    setPins((ps) => [...ps, { name: uniqueName(String(ps.length + 1)), x: p.x, y: p.y }])
    setSel(pins.length)
  }

  const onPinDown = (e: React.PointerEvent, i: number): void => {
    e.stopPropagation()
    setSel(i)
    record()
    dragRef.current = i
    const move = (ev: PointerEvent): void => {
      const p = surfacePoint(ev)
      setPins((ps) =>
        ps.map((pin, idx) => (idx === dragRef.current ? { ...pin, x: p.x, y: p.y } : pin))
      )
    }
    const up = (): void => {
      dragRef.current = -1
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** pins read from the art at a given box size (null when the art has none) */
  const pinsFromArt = (raw: string, bw: number, bh: number): Pin[] | null => {
    const scan = scanPins(raw, bw, bh)
    return scan.pins.length
      ? scan.pins.map((p) => ({ name: p.name, x: p.at[0], y: p.at[1] }))
      : null
  }

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const kind = editView
    const reader = new FileReader()
    reader.onload = (evt) => {
      const raw = String(evt.target?.result ?? '')
      if (!/<svg[\s>]/i.test(raw)) return
      const root = readSvgRoot(raw)
      const nw = Math.round((root.widthPx ?? root.vb[2]) * 100) / 100
      const nh = Math.round((root.heightPx ?? root.vb[3]) * 100) / 100
      const artPins = pinsFromArt(raw, nw, nh)
      record()
      setBuf((b) => ({
        ...b,
        raw,
        svg: previewOf(raw, kind),
        w: nw,
        h: nh,
        artChanged: true,
        sizeEdited: true,
        ...(artPins ? { pins: artPins, fromSvg: true, pinsEdited: false } : { fromSvg: false })
      }))
      setSel(-1)
    }
    reader.readAsText(file)
  }

  const resize = (nw: number, nh: number): void => {
    record()
    setBuf((b) => {
      const isBlank = !b.artChanged && !initial?.views[editView]
      const raw = isBlank ? blankSvg(nw, nh) : b.raw
      const artPins = b.fromSvg && !b.pinsEdited && raw ? pinsFromArt(raw, nw, nh) : null
      return {
        ...b,
        w: nw,
        h: nh,
        sizeEdited: true,
        ...(isBlank ? { raw, svg: raw } : {}),
        ...(artPins ? { pins: artPins } : {})
      }
    })
  }

  // One unit of the art's own coordinates, in part-box px: the viewBox is
  // fitted into the box uniformly, the way the canvas draws it.
  const artUnitPx = (): number => {
    if (!buf.raw) return 1
    const [, , vw, vh] = readSvgRoot(buf.raw).vb
    return Math.min(w / vw, h / vh)
  }

  /** Move the selected pin by (dx, dy) px, through the art when it owns the pins. */
  const nudge = (dx: number, dy: number): void => {
    const pin = pins[sel]
    if (!pin) return
    record()
    if (buf.fromSvg && !buf.pinsEdited && buf.raw) {
      const moved = movePinInArt(buf.raw, pin.name, dx, dy, w, h)
      if (moved) {
        const kind = editView
        setBuf((b) => ({
          ...b,
          raw: moved.svg,
          svg: previewOf(moved.svg, kind),
          artChanged: true,
          pins: b.pins.map((p, i) => (i === sel ? { ...p, x: moved.at[0], y: moved.at[1] } : p))
        }))
        return
      }
    }
    const r2 = (n: number): number => Math.round(n * 100) / 100
    setPins((ps) =>
      ps.map((p, i) =>
        i === sel
          ? {
              ...p,
              x: r2(Math.max(0, Math.min(w, p.x + dx))),
              y: r2(Math.max(0, Math.min(h, p.y + dy)))
            }
          : p
      )
    )
  }

  // Keyboard: arrows nudge the selected pin one art unit (Shift: 0.1 in);
  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))
        return
      if (matches(e, 'parts.undo')) {
        e.preventDefault()
        undo()
        return
      }
      if (matches(e, 'parts.redo') || matches(e, 'parts.redoAlt')) {
        e.preventDefault()
        redo()
        return
      }
      if (sel < 0 || (editView === 'schematic' && schMode === 'symbol')) return
      const grid = matches(e, 'parts.nudgeGrid')
      if (!grid && !matches(e, 'parts.nudge')) return
      const step = grid ? GRID_BB : artUnitPx()
      const d: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }
      if (!d[e.key]) return
      e.preventDefault()
      nudge(d[e.key][0], d[e.key][1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, editView, bb, sch, draft, schMode])

  const toMap = (ps: Pin[]): Record<string, [number, number]> => {
    const m: Record<string, [number, number]> = {}
    ps.forEach((p) => {
      m[p.name] = [p.x, p.y]
    })
    return m
  }

  const canSave = bb.pins.length > 0 || sch.pins.length > 0

  const build = (): { def: PartDef; info: PartsEditorSaveInfo } => {
    const type = initial ? initial.type : slug(name)
    const info: PartsEditorSaveInfo = {
      art: {},
      pinMode: {},
      sizeEdited: {},
      labelEdited: name !== (initial?.label ?? '')
    }
    const views: Partial<Record<ViewKind, PartView>> = {}
    const raw: NonNullable<PartSource['raw']> = { ...initial?.source?.raw }
    for (const [kind, b] of [
      ['breadboard', bb],
      ['schematic', sch]
    ] as [ViewKind, ViewBuf][]) {
      if (!(b.pins.length || initial?.views[kind])) continue
      views[kind] = {
        // "-edit": a kept icon may be this view's old file under the view prefix
        svg: b.raw ? namespaceSvg(prepareArt(b.raw), artPrefix(type, `${kind}-edit`)) : b.svg,
        w: b.w,
        h: b.h,
        pins: toMap(b.pins),
        ...(initial?.views[kind]?.legs ? { legs: initial.views[kind]!.legs } : {})
      }
      if (b.raw && (b.artChanged || !initial?.source?.raw?.[kind])) {
        info.art[kind] = b.raw
        raw[kind] = b.raw
      }
      info.pinMode[kind] = b.fromSvg && !b.pinsEdited ? 'svg' : 'fixed'
      info.sizeEdited[kind] = b.sizeEdited
    }
    if (!views.breadboard && !views.schematic)
      views.breadboard = { svg: bb.svg, w: bb.w, h: bb.h, pins: toMap(bb.pins) }
    const def: PartDef = {
      ...(initial ?? {}),
      // editing keeps the original identity so it updates in place (not a copy)
      type,
      label: name,
      family: initial?.family || 'Custom',
      // palette icon: keep a shipped part's own tile, else the first view's art
      icon: initial?.icon ?? (views.breadboard ?? views.schematic)!.svg,
      views,
      source: initial?.source ? { ...initial.source, raw } : undefined,
      origin: undefined
    }
    return { def, info }
  }

  const run = async (fn: () => void | Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const numField =
    'w-20 bg-bg-sunken border border-border-default rounded px-2 py-1 text-sm text-text-strong focus:border-brand outline-none'

  const artFile = initial?.source?.json?.views[editView]?.svg
  const artPath = initial?.source?.absDir
    ? `${initial.source.absDir}/${artFile ?? `${editView}.svg`}`
    : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--scrim)', backdropFilter: 'blur(3px)' }}
      onClick={onClose}
    >
      <div
        className="w-[900px] max-w-[94vw] h-[620px] max-h-[92vh] bg-surface-overlay border border-border-default rounded-xl flex flex-col overflow-hidden"
        style={{ boxShadow: 'var(--shadow-soft-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default">
          <span className="text-text-strong font-semibold">Parts editor</span>
          <span
            className="text-[11px] text-text-muted truncate"
            title={describeSource(initial, localEdit)}
          >
            {initial ? `“${initial.label}” · ${describeSource(initial, localEdit)}` : 'new part'}
          </span>
          {localEdit && onReset && (
            <button
              className="h-6 px-2 rounded-md border border-border-default text-[11px] text-text-body hover:text-brand hover:border-brand flex items-center gap-1 shrink-0"
              title="Delete this computer's copy and go back to the shipped part"
              disabled={busy}
              onClick={() => void run(onReset)}
            >
              <RotateCcw size={11} /> Reset to default
            </button>
          )}
          <div className="flex-1" />
          {/* view toggle: edit breadboard art or schematic symbol */}
          <div className="flex rounded-md overflow-hidden border border-border-default shrink-0">
            {(
              [
                ['breadboard', 'Breadboard'],
                ['schematic', 'Schematic']
              ] as [ViewKind, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                className={`h-7 px-2.5 text-xs font-medium ${
                  editView === v
                    ? 'bg-brand/15 text-brand'
                    : 'bg-surface-card text-text-muted hover:text-text-body'
                }`}
                onClick={() => switchView(v)}
              >
                {label}
                {(v === 'breadboard' ? bb.pins.length : sch.pins.length) > 0 ? ' •' : ''}
              </button>
            ))}
          </div>
          <button className="text-text-muted hover:text-text-strong ml-1" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* preview surface */}
          <div className="flex-1 flex items-center justify-center bg-bg-sunken overflow-auto p-6">
            {editView === 'schematic' && schMode === 'symbol' && draft ? (
              <SymbolCanvas
                draft={draft}
                scale={scale}
                selected={sel}
                onSelect={setSel}
                onChange={changeDraft}
              />
            ) : (
              <div
                ref={surfaceRef}
                className="relative cursor-crosshair"
                style={{
                  width: w * scale,
                  height: h * scale,
                  outline: '1px dashed var(--border-interactive)',
                  backgroundImage: 'radial-gradient(var(--dot-color) 1.1px, transparent 1.1px)',
                  backgroundSize: `${10 * scale}px ${10 * scale}px`
                }}
                onClick={onSurfaceClick}
              >
                <div
                  className="absolute inset-0 [&>svg]:size-full pointer-events-none"
                  dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
                />
                {pins.map((pin, i) => (
                  <div
                    key={i}
                    className="editor-pin absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: pin.x * scale, top: pin.y * scale, zIndex: 2 }}
                    onPointerDown={(e) => onPinDown(e, i)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className="rounded-full border-2"
                      style={{
                        width: 12,
                        height: 12,
                        background: i === sel ? 'var(--brand)' : 'var(--text-muted)',
                        borderColor: '#fff',
                        cursor: 'grab'
                      }}
                    />
                    <div className="absolute left-3 -top-1 text-[10px] text-brand whitespace-nowrap pointer-events-none">
                      {pin.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* inspector */}
          <div className="w-72 shrink-0 border-l border-border-default bg-bg-raised flex flex-col">
            <div className="p-3 flex flex-col gap-3 overflow-y-auto">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] text-text-muted">Name</span>
                <input
                  className="bg-bg-sunken border border-border-default rounded px-2 py-1 text-sm text-text-strong focus:border-brand outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {editView === 'schematic' && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-text-muted">Schematic</span>
                  <div className="flex rounded-md overflow-hidden border border-border-default">
                    {(
                      [
                        ['art', 'Art file'],
                        ['symbol', 'Symbol']
                      ] as ['art' | 'symbol', string][]
                    ).map(([m, label]) => (
                      <button
                        key={m}
                        className={`flex-1 h-7 text-xs font-medium ${
                          schMode === m
                            ? 'bg-brand/15 text-brand'
                            : 'bg-surface-card text-text-muted hover:text-text-body'
                        }`}
                        onClick={() => (m === 'symbol' ? enterSymbolMode() : setSchMode('art'))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] leading-snug text-text-faint">
                    {schMode === 'symbol'
                      ? 'A body, a name and pins on the 0.1 in grid. Saving writes it as schematic.svg.'
                      : 'The schematic art as a file: upload an SVG and place pins on it.'}
                  </div>
                </div>
              )}
              {editView === 'schematic' && schMode === 'symbol' && draft ? (
                <SymbolPanel
                  draft={draft}
                  selected={sel}
                  onSelect={setSel}
                  onChange={changeDraft}
                  onStartFromBox={() => changeDraft(draftFromBox())}
                  onStartFromArt={
                    initial?.views.schematic
                      ? () => changeDraft(draftFromView(initial.views.schematic!, name))
                      : undefined
                  }
                />
              ) : (
                <>
                  <div className="flex gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Width (px)</span>
                      <input
                        type="number"
                        className={numField}
                        value={w}
                        onChange={(e) => resize(Math.max(1, parseFloat(e.target.value) || 1), h)}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-text-muted">Height (px)</span>
                      <input
                        type="number"
                        className={numField}
                        value={h}
                        onChange={(e) => resize(w, Math.max(1, parseFloat(e.target.value) || 1))}
                      />
                    </label>
                  </div>

                  {/* where this view's art lives */}
                  <div className="rounded-lg border border-border-default bg-surface-card p-2 flex flex-col gap-1.5">
                    <div className="text-[11px] text-text-muted">
                      {editView === 'breadboard' ? 'Breadboard' : 'Schematic'} art
                    </div>
                    <div className="text-[11px] text-text-body break-all">
                      {buf.artChanged
                        ? 'uploaded, not saved yet'
                        : artFile && initial?.source?.dir
                          ? `tinyparts/${initial.source.dir}/${artFile}`
                          : initial?.views[editView]
                            ? 'inside the part definition'
                            : 'placeholder box'}
                    </div>
                    {artPath && !buf.artChanged && window.api?.fs && (
                      <button
                        className="self-start text-[11px] text-brand hover:underline flex items-center gap-1"
                        onClick={() => void window.api?.fs?.showInFolder(artPath)}
                      >
                        <FolderOpen size={11} /> Show in folder
                      </button>
                    )}
                    <label className="flex items-center justify-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border-interactive text-xs text-text-body hover:border-brand hover:text-text-strong cursor-pointer">
                      <UploadCloud size={14} /> Upload SVG…
                      <input
                        type="file"
                        accept=".svg,image/svg+xml"
                        className="hidden"
                        onChange={onUploadArt}
                      />
                    </label>
                    <div className="text-[10px] leading-snug text-text-faint">
                      {buf.fromSvg && !buf.pinsEdited
                        ? 'Pins come from the shapes named “pin-<NAME>” in the SVG, so moving them in Illustrator moves the pins.'
                        : buf.fromSvg
                          ? 'You moved pins by hand: their positions will be fixed in part.json and stop following the art.'
                          : 'Tip: name pad shapes “pin-GND”, “pin-D8”… in Illustrator and upload; pins place themselves.'}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-text-muted">Pins ({pins.length})</span>
                    <button
                      className="text-text-muted hover:text-brand"
                      title="Add pin at centre"
                      onClick={() => {
                        record()
                        setPins((ps) => [
                          ...ps,
                          {
                            name: uniqueName(String(ps.length + 1)),
                            x: Math.round(w / 2),
                            y: Math.round(h / 2)
                          }
                        ])
                        setSel(pins.length)
                      }}
                    >
                      <Plus size={15} />
                    </button>
                  </div>

                  <div className="flex flex-col gap-1">
                    {pins.map((pin, i) => (
                      <div
                        key={i}
                        className={`flex items-center gap-2 px-2 py-1 rounded border ${i === sel ? 'border-brand/50 bg-bg-sunken' : 'border-border-default'}`}
                        onClick={() => setSel(i)}
                      >
                        <input
                          className="flex-1 min-w-0 bg-transparent text-sm text-text-strong outline-none"
                          value={pin.name}
                          onFocus={record}
                          onChange={(e) => {
                            const v = e.target.value
                            setPins((ps) => ps.map((p, idx) => (idx === i ? { ...p, name: v } : p)))
                          }}
                          onBlur={(e) => {
                            const fixed = uniqueName(e.target.value || String(i + 1), i)
                            if (fixed !== pin.name)
                              setPins((ps) =>
                                ps.map((p, idx) => (idx === i ? { ...p, name: fixed } : p))
                              )
                          }}
                        />
                        <span className="text-[10px] text-text-faint">
                          {Math.round(pin.x * 100) / 100},{Math.round(pin.y * 100) / 100}
                        </span>
                        <button
                          className="text-text-faint hover:text-status-error"
                          onClick={(e) => {
                            e.stopPropagation()
                            record()
                            setPins((ps) => ps.filter((_, idx) => idx !== i))
                            setSel(-1)
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                    {pins.length === 0 ? (
                      <div className="text-[11px] text-text-faint py-2">
                        Click the preview to drop pins for the {editView} view.
                      </div>
                    ) : (
                      <div className="text-[10px] leading-snug text-text-faint py-1">
                        {keysOf('parts.nudge')} nudge the selected pin one art unit,{' '}
                        {keysOf('parts.nudgeGrid')} 0.1 in. {keysOf('parts.undo')} undoes.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="mt-auto p-3 border-t border-border-default flex flex-col gap-2">
              {onSaveToFolder && (
                <div className="flex flex-col gap-1.5">
                  {!initial?.source?.pack && folderPacks && folderPacks.length > 0 && (
                    <label className="flex items-center gap-2 text-[11px] text-text-muted">
                      Pack
                      <select
                        className="flex-1 bg-bg-sunken border border-border-default rounded px-1.5 py-1 text-xs text-text-strong outline-none"
                        value={targetPack}
                        onChange={(e) => setTargetPack(e.target.value)}
                      >
                        {folderPacks.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    className="w-full px-3 py-2 rounded-lg bg-brand border border-brand text-sm text-brand-contrast font-medium hover:brightness-105 disabled:opacity-40"
                    disabled={!canSave || busy || !targetPack}
                    title="Write part.json and the .svg files into your tinyparts folder. Commit and push tinyparts to share."
                    onClick={() => {
                      const { def, info } = build()
                      void run(() => onSaveToFolder(def, info, targetPack))
                    }}
                  >
                    Save to tinyparts
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg bg-surface-card border border-border-default text-sm text-text-body hover:bg-bg-sunken"
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-40 ${
                    onSaveToFolder
                      ? 'bg-surface-card border border-border-default text-text-body hover:bg-bg-sunken'
                      : 'bg-brand border border-brand text-brand-contrast hover:brightness-105'
                  }`}
                  disabled={!canSave || busy}
                  title="Keep this version on this computer only. It replaces the shipped part here until you reset it."
                  onClick={() => {
                    const { def, info } = build()
                    void run(() => onSave(def, info))
                  }}
                >
                  Save on this computer
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
