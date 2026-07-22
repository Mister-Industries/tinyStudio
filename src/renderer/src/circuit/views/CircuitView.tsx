/**
 * circuit/views/CircuitView — the Circuit View v2 shell (M1: breadboard
 * editor parity). Composes: components palette · interactive Canvas ·
 * Inspector rail · toolbar (edit toggle, grid, export, code) · zoom cluster ·
 * status pills. Owns the CircuitStore and the debounced save path
 * (store.serialize() → onChange → Redux buffer; disk save stays on Ctrl+S,
 * same as every other editor buffer).
 *
 * Mounted directly by EditorPanel's CircuitView in the Circuit tab — desktop
 * and web builds. This has been the only circuit editor since M4 (the legacy
 * DiagramEditor and its feature flag were removed).
 */

import {
  CircleAlert,
  CodeXml,
  Eye,
  FileCode2,
  Grid3x3,
  ImageDown,
  Info,
  Maximize,
  Pencil,
  Play,
  Redo2,
  ShieldCheck,
  TriangleAlert,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import React from 'react'
import { ensureParts, getPart, loadPart, registerPart, type PartDef } from '../../lib/partsLibrary'
import { toast } from 'sonner'
import { initUserParts, saveUserPart } from '../../lib/userParts'
import { importFzpz } from '../parts/fzpz'
import { PartsEditor } from '../../components/PartsEditor'
import * as cmd from '../core/commands'
import { newId, type NetLabelKind, type Pt, type ViewId } from '../core/model'
import { buildNets } from '../core/nets'
import type { SimIssueRef } from '../core/netlist'
import { runErc, type ErcIssue, type ErcSeverity } from '../core/erc'
import { nextRefdes, prefixForFamily } from '../core/refdes'
import { CircuitStore } from '../core/store'
import { BREADBOARDS, generateBreadboard, isBreadboard } from '../parts/breadboard'
import { SIM_SOURCES, generateSimSource, simSourceDefaultAttrs } from '../parts/simParts'
import { SIM_PROBES, generateSimProbe, simProbeDefaultAttrs } from '../parts/simProbes'
import { PackManager } from './packs/PackManager'
import { snapNetLabel } from '../parts/netLabels'
import { Canvas, emptySel, type Cam, type CanvasHandle, type Selection } from './canvas/Canvas'
import { exportPng, exportSvg } from './exportImage'
import { InspectorRail } from './inspector/Inspector'
import { Palette, WIRE_COLORS } from './palette/Palette'
import {
  circuitBuses,
  ercFloatingPins,
  findFreePlacement,
  implicitSeats,
  pinWorldOf,
  ratsnest
} from './partsAdapter'
import { SimPanel, fmtSI, type SimState } from './sim/SimPanel'

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
    for (const s of SIM_SOURCES) if (!getPart(s.type)) registerPart(generateSimSource(s))
    for (const s of SIM_PROBES) if (!getPart(s.type)) registerPart(generateSimProbe(s))
    return CircuitStore.fromFile(content)
  })
  const revision = React.useSyncExternalStore(store.subscribe, store.getRevision)
  const doc = store.getDoc()

  const [editable, setEditable] = React.useState(false)
  const [view, setView] = React.useState<ViewId>('bb')
  const [grid, setGrid] = React.useState(true)
  const [sel, setSel] = React.useState<Selection>(emptySel())
  const [wireColor, setWireColor] = React.useState(WIRE_COLORS[0])
  const [cam, setCam] = React.useState<Cam>({ scale: 1, tx: 40, ty: 40 })
  const [editorPart, setEditorPart] = React.useState<PartDef | null | undefined>(undefined)
  const [showPacks, setShowPacks] = React.useState(false)
  const [showErc, setShowErc] = React.useState(false)
  const [showSim, setShowSim] = React.useState(false)
  const [sim, setSim] = React.useState<SimState>({ run: null, netlist: null })
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

  // restore persisted user parts (B7), then lazy-load part defs through the
  // legacy adapter — user parts must land first so custom types resolve
  React.useEffect(() => {
    void initUserParts().then((n) => {
      const missing = doc.parts.map((p) => p.type).filter((t) => !getPart(t))
      if (missing.length) void ensureParts(missing).then(bumpDefs)
      else if (n) bumpDefs()
    })
  }, [doc.parts])

  // drop selection entries that no longer exist (undo, delete, external edit)
  React.useEffect(() => {
    const partIds = new Set(doc.parts.map((p) => p.id))
    const wireIds = new Set(doc.wires.map((w) => w.id))
    if (
      [...sel.parts].every((id) => partIds.has(id)) &&
      [...sel.wires].every((id) => wireIds.has(id))
    )
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

  // sim results go stale the moment the circuit changes — drop them
  React.useEffect(() => {
    setSim((s) => (s.run || s.netlist ? { run: null, netlist: null } : s))
  }, [doc])

  // DC (.op) node voltages → world-anchored chips at one pin per net
  const simAnnotations = React.useMemo(() => {
    if (!sim.run || sim.run.numPoints !== 1 || !sim.netlist) return []
    const out: { x: number; y: number; text: string }[] = []
    sim.netlist.nodeOfNet.forEach((node, i) => {
      if (node === '0') return
      const vec = sim.run!.vectors.find((v) => v.name.toLowerCase() === `v(${node.toLowerCase()})`)
      if (!vec || vec.values.length !== 1) return
      for (const ref of netModel.nets[i] ?? []) {
        const ci = ref.lastIndexOf(':')
        const part = doc.parts.find((p) => p.id === ref.slice(0, ci))
        if (!part) continue
        const pt = pinWorldOf(part, ref.slice(ci + 1), undefined, view)
        if (!pt) continue
        out.push({ x: pt.x, y: pt.y, text: fmtSI(vec.values[0], 'V') })
        break
      }
    })
    return out
  }, [sim, netModel, doc, view])
  // per-net voltage lookup for the breadboard hole tooltip (M4 leftover) —
  // same DC (.op) result as the canvas chips, keyed by net index instead of
  // pre-picking one representative pin, so every hole in the net can show it.
  const simVoltageForNet = React.useCallback(
    (netIdx: number): string | undefined => {
      if (!sim.run || sim.run.numPoints !== 1 || !sim.netlist) return undefined
      const node = sim.netlist.nodeOfNet[netIdx]
      if (!node || node === '0') return undefined
      const vec = sim.run.vectors.find((v) => v.name.toLowerCase() === `v(${node.toLowerCase()})`)
      if (!vec || vec.values.length !== 1) return undefined
      return fmtSI(vec.values[0], 'V')
    },
    [sim]
  )
  // nets satisfied elsewhere but unrouted here → dashed guidance (spec §8.2)
  const rats = React.useMemo(() => ratsnest(doc, view, netModel), [doc, view, netModel, defsTick])
  // ERC: net-model rules + view-side floating-pin findings (spec §9)
  const erc = React.useMemo(
    () => [...runErc(doc, netModel), ...ercFloatingPins(doc, netModel, view)],
    [doc, netModel, view, defsTick]
  )
  const ercCount = React.useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 } as Record<ErcSeverity, number>
    for (const i of erc) c[i.severity]++
    return c
  }, [erc])
  const selectErc = (i: ErcIssue): void => {
    if (i.ref?.part) setSel({ parts: new Set([i.ref.part]), wires: new Set(), labels: new Set() })
    else if (i.ref?.wire)
      setSel({ parts: new Set(), wires: new Set([i.ref.wire]), labels: new Set() })
    else if (i.ref?.label)
      setSel({ parts: new Set(), wires: new Set(), labels: new Set([i.ref.label]) })
  }
  // sim error chip click (mapSimIssues): select the implicated part(s), plus
  // every part touching an implicated net (a net has no its own selection).
  const selectSimIssue = (refs: SimIssueRef): void => {
    const partIds = new Set(refs.parts)
    for (const i of refs.nets) {
      for (const ref of netModel.nets[i] ?? []) partIds.add(ref.slice(0, ref.lastIndexOf(':')))
    }
    setSel({ parts: partIds, wires: new Set(), labels: new Set() })
  }
  // parts with no placement in the current view live in the tray.
  // Breadboards are excluded from the schematic entirely (spec §10.2: they
  // are transparent — their row/rail buses still merge nets globally).
  const trayParts = React.useMemo(
    () =>
      doc.parts.filter((p) => !p[view] && (view === 'bb' ? p.sch : p.bb && !isBreadboard(p.type))),
    [doc, view]
  )
  // one compact warning bubble: unplaced parts, unwired nets, ERC err/warn
  const problems = React.useMemo(() => {
    const bits: string[] = []
    if (trayParts.length) bits.push(`${trayParts.length} unplaced`)
    if (rats.length) bits.push(`${rats.length} unwired net${rats.length > 1 ? 's' : ''}`)
    const ercN = ercCount.error + ercCount.warning
    if (ercN) bits.push(`${ercN} ERC`)
    return bits
  }, [trayParts, rats, ercCount])

  // switching views: selection is per-view state, wires especially
  const switchView = (v: ViewId): void => {
    if (v === view) return
    setView(v)
    setSel(emptySel())
    requestAnimationFrame(() => canvasRef.current?.fit())
  }

  const enterEdit = (): void => {
    if (editable) return
    setEditable(true)
    onEditChange?.(true)
  }

  // Placing an unplaced part: drop it straight onto a free slot (no second
  // click) and flip into edit mode so it can be dragged immediately.
  const placeFromTray = (partId: string): void => {
    const part = doc.parts.find((p) => p.id === partId)
    if (!part) return
    const c = canvasRef.current?.centerWorld() ?? { x: 300, y: 200 }
    store.dispatch(cmd.placePart(partId, view, findFreePlacement(doc, part.type, view, c)))
    setSel({ parts: new Set([partId]), wires: new Set() })
    enterEdit()
  }

  // ── actions ─────────────────────────────────────────────────────────────────

  const addPartAt = async (type: string, at?: Pt): Promise<void> => {
    const def = getPart(type) || (await loadPart(type))
    if (!def) return
    bumpDefs()
    const p = at ?? canvasRef.current?.centerWorld() ?? { x: 300, y: 200 }
    const id = nextRefdes(store.getDoc(), prefixForFamily(`${def.family ?? ''} ${def.type}`))
    const pl = findFreePlacement(store.getDoc(), type, view, p)
    const attrs = simSourceDefaultAttrs(type) ?? simProbeDefaultAttrs(type)
    store.dispatch(cmd.addPart({ id, type, ...(attrs ? { attrs } : {}), [view]: pl }))
    setSel({ parts: new Set([id]), wires: new Set() })
  }

  // .fzpz dropped on the canvas: convert → persist → place at the cursor
  const importFzpzFiles = async (files: File[], at: Pt): Promise<void> => {
    for (const f of files) {
      try {
        const { def, warnings } = await importFzpz(new Uint8Array(await f.arrayBuffer()), f.name)
        await saveUserPart(def)
        bumpDefs()
        await addPartAt(def.type, at)
        toast.success(`Imported ${def.label}`, {
          description: warnings.length
            ? `${warnings.length} pin${warnings.length === 1 ? '' : 's'} could not be resolved`
            : `${def.family} · now in the palette`
        })
      } catch (err) {
        toast.error(`Couldn't import ${f.name}`, {
          description: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  const addNetLabel = (kind: NetLabelKind, name: string, at?: Pt): void => {
    const c = at ?? canvasRef.current?.centerWorld() ?? { x: 300, y: 200 }
    const id = newId('nl')
    const sch = snapNetLabel(kind, name, { x: Math.round(c.x), y: Math.round(c.y) })
    store.dispatch(cmd.addNetLabel({ id, name, kind, sch }))
    setSel({ parts: new Set(), wires: new Set(), labels: new Set([id]) })
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
          view={view}
          wireColor={wireColor}
          onPickColor={pickColor}
          onAdd={(type) => void addPartAt(type)}
          onAddNetLabel={(kind, name) => addNetLabel(kind as NetLabelKind, name)}
          onEditPart={(type) => void editExisting(type)}
          onNewPart={() => setEditorPart(null)}
          onOpenPacks={() => setShowPacks(true)}
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

        {/* view toggle: Breadboard | Schematic */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex rounded-md overflow-hidden tactile-bordered">
          {(
            [
              ['bb', 'Breadboard'],
              ['sch', 'Schematic']
            ] as [ViewId, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              className={`h-8 px-3 text-xs font-medium ${
                view === v
                  ? 'bg-brand/15 text-brand'
                  : 'bg-surface-card text-text-muted hover:text-text-body'
              }`}
              onClick={() => switchView(v)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* unplaced tray: parts that only exist in the other view */}
        {trayParts.length > 0 && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 items-center flex-wrap max-w-[70%] justify-center">
            <span className="text-[10px] text-text-faint">unplaced here:</span>
            {trayParts.map((part) => (
              <button
                key={part.id}
                className="px-2 py-0.5 rounded-full bg-surface-card border border-dashed border-border-strong text-[11px] text-text-body hover:border-brand hover:text-brand"
                title={`${part.type} — click to place it in this view`}
                onClick={() => placeFromTray(part.id)}
              >
                {part.id}
              </button>
            ))}
          </div>
        )}

        {/* right toolbar: export / grid / code */}
        <div className="absolute top-3 right-3.5 z-10 flex gap-1.5">
          <button
            className={`${tool} w-8 justify-center px-0 ${showSim ? 'text-brand' : ''}`}
            onClick={() => setShowSim((s) => !s)}
            title="Simulate"
          >
            <Play size={15} />
          </button>
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => exportPng(doc, view)}
            title="Export as PNG"
          >
            <ImageDown size={15} />
          </button>
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => exportSvg(doc, view)}
            title="Export as SVG"
          >
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
            <button
              className={`${tool} w-8 justify-center px-0`}
              onClick={onOpenCode}
              title="Edit circuit.json as code"
            >
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
          <button
            className={`${tool} w-8 justify-center px-0`}
            onClick={() => canvasRef.current?.fit()}
            title="Fit to view"
          >
            <Maximize size={15} />
          </button>
        </div>

        {/* only surfaces when something needs attention: unwired nets / unplaced
            parts / ERC (click for details), plus the one-time migration note. */}
        {(problems.length > 0 || migrated || warnings.length > 0) && (
          <div className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-2 text-[11px] max-w-[60%]">
            {problems.length > 0 && (
              <button
                className={`px-2.5 py-1 rounded-full bg-surface-card border flex items-center gap-1.5 ${
                  ercCount.error
                    ? 'border-status-danger/40 text-status-danger'
                    : 'border-status-warning/40 text-status-warning'
                }`}
                onClick={() => setShowErc((v) => !v)}
                title="Show issues"
              >
                <TriangleAlert size={12} /> {problems.join(' · ')}
              </button>
            )}
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
        )}

        {/* ERC panel (spec §9): non-blocking findings list */}
        {showErc && (
          <div className="absolute bottom-12 left-3 z-20 w-80 max-h-[45%] flex flex-col rounded-lg border border-border-default bg-surface-card shadow-lg overflow-hidden">
            <div className="h-8 shrink-0 flex items-center justify-between px-3 border-b border-border-default">
              <span className="text-[12px] font-semibold text-text-body">
                Electrical rule check
              </span>
              <button
                className="text-text-muted hover:text-text-body"
                onClick={() => setShowErc(false)}
              >
                <X size={13} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-1 text-[11px]">
              {erc.length === 0 ? (
                <div className="flex items-center gap-1.5 text-status-ok px-1 py-2">
                  <ShieldCheck size={13} /> No issues found.
                </div>
              ) : (
                erc.map((i) => <ErcRow key={i.id} issue={i} onSelect={selectErc} />)
              )}
            </div>
          </div>
        )}

        <Canvas
          key={view}
          store={store}
          doc={doc}
          view={view}
          editable={editable}
          grid={grid}
          sel={sel}
          setSel={setSel}
          wireColor={wireColor}
          netModel={netModel}
          seats={seats}
          rats={rats}
          defsTick={defsTick}
          cam={cam}
          setCam={setCam}
          handleRef={canvasRef}
          onDropPart={(type, at) => void addPartAt(type, at)}
          onDropNetLabel={(kind, name, at) => addNetLabel(kind, name, at)}
          onImportFiles={(files, at) => void importFzpzFiles(files, at)}
          annotations={simAnnotations}
          simVoltageForNet={simVoltageForNet}
          onRequestEdit={enterEdit}
        />

        {showSim && (
          <SimPanel
            doc={doc}
            netModel={netModel}
            store={store}
            familyOf={(t) => getPart(t)?.family}
            onClose={() => setShowSim(false)}
            onResult={setSim}
            onSelectIssue={selectSimIssue}
          />
        )}

        {/* watermark — matches the header wordmark: thin 'tiny', bold 'Studio' */}
        <div className="absolute bottom-8 right-6 z-0 pointer-events-none select-none text-[60px] leading-none tracking-[-0.02em] text-text-faint/25">
          <span className="font-light">tiny</span>
          <span className="font-extrabold">Studio</span>
        </div>
      </div>

      {editable && (
        <InspectorRail
          doc={doc}
          store={store}
          sel={sel}
          setSel={setSel}
          netModel={netModel}
          view={view}
        />
      )}

      {editorPart !== undefined && (
        <PartsEditor
          initial={editorPart}
          onClose={() => setEditorPart(undefined)}
          onSave={(def: PartDef) => {
            void saveUserPart(def)
            bumpDefs()
            setEditorPart(undefined)
          }}
        />
      )}

      {showPacks && (
        <PackManager onClose={() => setShowPacks(false)} onInstalled={() => bumpDefs()} />
      )}
    </div>
  )
}

function ErcRow({
  issue,
  onSelect
}: {
  issue: ErcIssue
  onSelect: (i: ErcIssue) => void
}): React.JSX.Element {
  const color =
    issue.severity === 'error'
      ? 'text-status-danger'
      : issue.severity === 'warning'
        ? 'text-status-warning'
        : 'text-text-muted'
  const Icon =
    issue.severity === 'error' ? CircleAlert : issue.severity === 'warning' ? TriangleAlert : Info
  const clickable = !!(issue.ref?.part || issue.ref?.wire || issue.ref?.label)
  return (
    <button
      className={`flex items-start gap-1.5 text-left px-1.5 py-1 rounded hover:bg-bg-sunken ${
        clickable ? '' : 'cursor-default'
      }`}
      onClick={() => clickable && onSelect(issue)}
    >
      <Icon size={13} className={`mt-px shrink-0 ${color}`} />
      <span className="text-text-body leading-snug">{issue.message}</span>
    </button>
  )
}
