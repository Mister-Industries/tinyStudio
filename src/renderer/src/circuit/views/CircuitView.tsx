/**
 * circuit/views/CircuitView — the Circuit View v2 shell (M1: breadboard
 * editor parity). Composes: components palette · interactive Canvas ·
 * Inspector rail · toolbar (edit toggle, grid, export, code) · zoom cluster ·
 * status pills. Owns the CircuitStore and the debounced save path
 * (store.serialize() → onChange → Redux buffer; disk save stays on Ctrl+S,
 * same as every other editor buffer).
 *
 * Mounted by EditorPanel behind the `tinystudio.circuitV2` flag, in the same
 * window slot the legacy DiagramEditor occupies — desktop and web builds.
 */

import {
  CodeXml,
  Eye,
  FileCode2,
  Grid3x3,
  ImageDown,
  Maximize,
  Pencil,
  Redo2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import React from 'react'
import {
  ensureParts,
  getPart,
  loadPart,
  registerPart,
  viewFor,
  type PartDef
} from '../../lib/partsLibrary'
import { PartsEditor } from '../../components/PartsEditor'
import * as cmd from '../core/commands'
import { type Pt } from '../core/model'
import { buildNets } from '../core/nets'
import { nextRefdes, prefixForFamily } from '../core/refdes'
import { CircuitStore } from '../core/store'
import { BREADBOARDS, generateBreadboard } from '../parts/breadboard'
import { Canvas, emptySel, type Cam, type CanvasHandle, type Selection } from './canvas/Canvas'
import { exportPng, exportSvg } from './exportImage'
import { InspectorRail } from './inspector/Inspector'
import { Palette, WIRE_COLORS } from './palette/Palette'
import { circuitBuses, implicitSeats, snapBB } from './partsAdapter'

export function CircuitViewV2({
  content,
  onChange,
  onOpenCode,
  onEditChange
}: {
  content: string
  onChange: (next: string) => void
  onOpenCode?: () => void
  onEditChange?: (editing: boolean) => void
}): React.JSX.Element {
  const [{ store, migrated, warnings }] = React.useState(() => {
    // procedural breadboards live in the legacy registry until the M2+ pack
    // registry replaces it — register once, before first geometry pass
    for (const s of BREADBOARDS) if (!getPart(s.type)) registerPart(generateBreadboard(s).def)
    return CircuitStore.fromFile(content)
  })
  const revision = React.useSyncExternalStore(store.subscribe, store.getRevision)
  const doc = store.getDoc()

  const [editable, setEditable] = React.useState(false)
  const [grid, setGrid] = React.useState(true)
  const [sel, setSel] = React.useState<Selection>(emptySel())
  const [wireColor, setWireColor] = React.useState(WIRE_COLORS[0])
  const [cam, setCam] = React.useState<Cam>({ scale: 1, tx: 40, ty: 40 })
  const [editorPart, setEditorPart] = React.useState<PartDef | null | undefined>(undefined)
  const [defsTick, bumpDefs] = React.useReducer((n: number) => n + 1, 0)
  const canvasRef = React.useRef<CanvasHandle>(null)

  // ── file sync ───────────────────────────────────────────────────────────────

  // External content changes (Code tab / disk) fold in as an undoable step;
  // our own serialized echoes are ignored by the store. Externally-caused
  // revisions must NOT trigger a save (that would reformat under the user's
  // cursor in the Code tab).
  const skipSaveRev = React.useRef(0)
  React.useEffect(() => {
    const res = store.replaceFromFile(content)
    if (res.applied) skipSaveRev.current = store.getRevision()
  }, [content, store])

  React.useEffect(() => {
    if (revision === 0 || revision === skipSaveRev.current) return
    const t = setTimeout(() => onChange(store.serialize()), 250)
    return () => clearTimeout(t)
  }, [revision, store, onChange])

  // lazy-load part defs through the legacy adapter
  React.useEffect(() => {
    const missing = doc.parts.map((p) => p.type).filter((t) => !getPart(t))
    if (missing.length) void ensureParts(missing).then(bumpDefs)
  }, [doc.parts])

  // drop selection entries that no longer exist (undo, delete, external edit)
  React.useEffect(() => {
    const partIds = new Set(doc.parts.map((p) => p.id))
    const wireIds = new Set(doc.wires.map((w) => w.id))
    if ([...sel.parts].every((id) => partIds.has(id)) && [...sel.wires].every((id) => wireIds.has(id)))
      return
    setSel({
      parts: new Set([...sel.parts].filter((id) => partIds.has(id))),
      wires: new Set([...sel.wires].filter((id) => wireIds.has(id)))
    })
  }, [doc, sel])

  // derived breadboard seating (drop-to-connect) + bus-aware net model
  const seats = React.useMemo(() => implicitSeats(doc), [doc, defsTick])
  const netModel = React.useMemo(
    () =>
      buildNets(doc, {
        busesFor: circuitBuses,
        implicit: seats.map((s): [string, string] => [s.pin, s.hole])
      }),
    [doc, seats]
  )

  // ── actions ─────────────────────────────────────────────────────────────────

  const addPartAt = async (type: string, at?: Pt): Promise<void> => {
    const def = getPart(type) || (await loadPart(type))
    if (!def) return
    bumpDefs()
    const v = viewFor(def, 'breadboard')
    const w = v?.w || 80
    const h = v?.h || 40
    const p = at ?? canvasRef.current?.centerWorld() ?? { x: 300, y: 200 }
    const id = nextRefdes(store.getDoc(), prefixForFamily(`${def.family ?? ''} ${def.type}`))
    const bb = snapBB(type, { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2) })
    store.dispatch(cmd.addPart({ id, type, bb }))
    setSel({ parts: new Set([id]), wires: new Set() })
  }

  const pickColor = (c: string): void => {
    setWireColor(c)
    if (sel.wires.size === 1 && sel.parts.size === 0)
      store.dispatch(cmd.recolorWire([...sel.wires][0], c))
  }

  const editExisting = async (type: string): Promise<void> => {
    const def = getPart(type) || (await loadPart(type))
    if (def) setEditorPart(def)
  }

  const tool =
    'tactile-bordered h-8 px-2.5 flex items-center gap-1.5 rounded-md bg-surface-card text-text-muted text-xs hover:text-text-body active:translate-y-px'

  return (
    <div className="size-full relative flex bg-bg overflow-hidden pb-7">
      {editable && (
        <Palette
          wireColor={wireColor}
          onPickColor={pickColor}
          onAdd={(type) => void addPartAt(type)}
          onEditPart={(type) => void editExisting(type)}
          onNewPart={() => setEditorPart(null)}
        />
      )}

      <div className="flex-1 relative min-w-0 overflow-hidden flex">
        {/* left toolbar: edit toggle + undo/redo */}
        <div className="absolute top-3 left-3 z-10 flex gap-1.5">
          <button
            className={`${tool} w-8 justify-center px-0 ${editable ? 'text-brand' : ''}`}
            onClick={() => {
              const next = !editable
              setEditable(next)
              setSel(emptySel())
              onEditChange?.(next)
            }}
            title={editable ? 'Editing — click for view-only' : 'View-only — click to edit'}
          >
            {editable ? <Eye size={15} /> : <Pencil size={15} />}
          </button>
          {editable && (
            <>
              <button
                className={`${tool} w-8 justify-center px-0 disabled:opacity-40`}
                disabled={!store.canUndo()}
                onClick={() => store.undo()}
                title={store.undoLabel() ? `Undo ${store.undoLabel()} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}
              >
                <Undo2 size={15} />
              </button>
              <button
                className={`${tool} w-8 justify-center px-0 disabled:opacity-40`}
                disabled={!store.canRedo()}
                onClick={() => store.redo()}
                title="Redo (Ctrl+Y)"
              >
                <Redo2 size={15} />
              </button>
            </>
          )}
        </div>

        {/* right toolbar: export / grid / code */}
        <div className="absolute top-3 right-3.5 z-10 flex gap-1.5">
          <button className={`${tool} w-8 justify-center px-0`} onClick={() => exportPng(doc)} title="Export as PNG">
            <ImageDown size={15} />
          </button>
          <button className={`${tool} w-8 justify-center px-0`} onClick={() => exportSvg(doc)} title="Export as SVG">
            <FileCode2 size={15} />
          </button>
          <button
            className={`${tool} w-8 justify-center px-0 ${grid ? 'text-brand' : ''}`}
            onClick={() => setGrid((g) => !g)}
            title="Toggle grid"
          >
            <Grid3x3 size={15} />
          </button>
          {onOpenCode && (
            <button className={`${tool} w-8 justify-center px-0`} onClick={onOpenCode} title="Edit circuit.json as code">
              <CodeXml size={15} />
            </button>
          )}
        </div>

        {/* zoom cluster */}
        <div className="absolute bottom-3 right-3.5 z-10 flex gap-1.5">
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => canvasRef.current?.zoomCenter(1 / 1.15)}
            title="Zoom out"
          >
            <ZoomOut size={15} />
          </button>
          <span className={`${tool} pointer-events-none min-w-[52px] justify-center`}>
            {Math.round(cam.scale * 100)}%
          </span>
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => canvasRef.current?.zoomCenter(1.15)}
            title="Zoom in"
          >
            <ZoomIn size={15} />
          </button>
          <button className={`${tool} w-8 justify-center px-0`} onClick={() => canvasRef.current?.fit()} title="Fit to view">
            <Maximize size={15} />
          </button>
        </div>

        {/* status pills */}
        <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 text-[11px] max-w-[60%]">
          <span className="px-2.5 py-1 rounded-full bg-surface-card border border-border-default text-text-body">
            Parts: {doc.parts.length} · Wires: {doc.wires.length} · Nets: {netModel.meaningful}
          </span>
          {migrated && (
            <span className="px-2.5 py-1 rounded-full bg-surface-card border border-brand/40 text-brand">
              migrated from diagram.json
            </span>
          )}
          {warnings.length > 0 && (
            <span
              className="px-2.5 py-1 rounded-full bg-surface-card border border-status-warning/40 text-status-warning"
              title={warnings.join('\n')}
            >
              {warnings.length} migration note{warnings.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        <Canvas
          store={store}
          doc={doc}
          editable={editable}
          grid={grid}
          sel={sel}
          setSel={setSel}
          wireColor={wireColor}
          netModel={netModel}
          seats={seats}
          defsTick={defsTick}
          cam={cam}
          setCam={setCam}
          handleRef={canvasRef}
          onDropPart={(type, at) => void addPartAt(type, at)}
        />

        {/* watermark */}
        <div className="absolute bottom-12 right-4 z-0 pointer-events-none select-none text-[12px] font-semibold text-text-faint/70">
          tinyStudio
        </div>
      </div>

      {editable && <InspectorRail doc={doc} store={store} sel={sel} setSel={setSel} netModel={netModel} />}

      {editorPart !== undefined && (
        <PartsEditor
          initial={editorPart}
          onClose={() => setEditorPart(undefined)}
          onSave={(def: PartDef) => {
            registerPart(def)
            bumpDefs()
            setEditorPart(undefined)
          }}
        />
      )}
    </div>
  )
}
