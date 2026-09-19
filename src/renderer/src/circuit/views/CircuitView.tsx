/**
 * circuit/views/CircuitView: the Circuit View v2 shell (M1: breadboard
 * editor parity). Composes: components palette · interactive Canvas ·
 * Inspector rail · toolbar (edit toggle, grid, export, code) · zoom cluster ·
 * status pills. Owns the CircuitStore and the debounced save path
 * (store.serialize() → onChange → Redux buffer; disk save stays on Ctrl+S,
 * same as every other editor buffer).
 *
 * Mounted by components/editor/CircuitPane in the Circuit tab, in both desktop
 * and web builds. This has been the only circuit editor since M4 (the legacy
 * DiagramEditor and its feature flag were removed).
 */

import {
  ChevronDown,
  CircleAlert,
  CircuitBoard,
  CodeXml,
  Cpu,
  Download,
  Eye,
  FileCode2,
  Grip,
  ImageDown,
  Info,
  ListOrdered,
  Maximize,
  Pencil,
  Play,
  Redo2,
  ShieldCheck,
  Share,
  TriangleAlert,
  Undo2,
  X,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import React from 'react'
import { reportError } from '../../lib/notify'
import { keysOf } from '../../lib/shortcuts'
import {
  PART_MANIFEST,
  ensureParts,
  getPart,
  loadPart,
  onPartsChanged,
  registerPart,
  type PartDef
} from '../../lib/partsLibrary'
import { toast } from 'sonner'
import { isLocalEdit, resetUserPart, saveUserPart } from '../../lib/userParts'
import { importFzpz } from '../parts/fzpz'
import { PartsEditor } from '../../components/PartsEditor'
import { initPartsLibrary } from '../parts/partsBoot'
import {
  devFolderActive,
  devTargetPacks,
  getDevStatus,
  onDevStatus,
  savePartToFolder
} from '../parts/devFolder'
import { getSyncStatus, onSyncStatus } from '../parts/tinypartsSync'
import * as cmd from '../core/commands'
import {
  newId,
  type NetLabelKind,
  type Placement,
  type Probe,
  type Pt,
  type ViewId
} from '../core/model'
import { buildNets } from '../core/nets'
import { nodeNamesForNets, type SimIssueRef } from '../core/netlist'
import { runErc, type ErcIssue, type ErcSeverity } from '../core/erc'
import { looksLikeSlug, nextRefdes, prefixForFamily, renumberAll } from '../core/refdes'
import { CircuitStore } from '../core/store'
import { BREADBOARDS, generateBreadboard, isBreadboard } from '../parts/breadboard'
import { defaultAttrsFor, resolveNaming } from '../parts/naming'
import { SIM_SOURCES, generateSimSource, simSourceDefaultAttrs } from '../parts/simParts'
import { SIM_PROBES, generateSimProbe, simProbeDefaultAttrs } from '../parts/simProbes'
import { PackManager } from './packs/PackManager'
import { snapNetLabel } from '../parts/netLabels'
import { Canvas, type Cam, type CanvasHandle, type ProbeTag } from './canvas/Canvas'
import { emptySel, type Selection } from './canvas/selection'
import { playCaptureAnimation } from './captureAnimation'
import { renderPng, saveImage, exportSvg } from './exportImage'
import { InspectorRail } from './inspector/Inspector'
import { Palette } from './palette/Palette'
import { WIRE_COLORS } from './palette/wireColors'
import {
  autoPlacementFor,
  circuitBuses,
  ercFloatingPins,
  findFreePlacement,
  implicitSeats,
  pinWorldOf,
  ratsnest
} from './partsAdapter'
import {
  makeProbe,
  netLabelFor,
  netOutputRefByIndex,
  probeAnchor,
  probeFor,
  vectorForOutput,
  PROBE_DEFAULT_OFFSET,
  type OutputRef
} from '../core/simOutputs'
import { getSimBackend } from '../sim'
import { fmtSI } from './sim/format'
import { SimPanel, type SimState } from './sim/SimPanel'

/**
 * Which panel the right-hand rail is showing.
 *
 * The rail is not always there: Properties belongs to editing and Simulate
 * belongs to the schematic, so the breadboard in view-only mode has no rail at
 * all and the canvas gets the whole width. `railVisible` below is the single
 * place that rule lives.
 */
type RailTab = 'properties' | 'simulate'

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
    // registry replaces it; register once, before first geometry pass
    for (const s of BREADBOARDS) if (!getPart(s.type)) registerPart(generateBreadboard(s).def)
    for (const s of SIM_SOURCES) if (!getPart(s.type)) registerPart(generateSimSource(s))
    for (const s of SIM_PROBES) if (!getPart(s.type)) registerPart(generateSimProbe(s))
    return CircuitStore.fromFile(content)
  })
  const revision = React.useSyncExternalStore(store.subscribe, store.getRevision)
  const doc = store.getDoc()

  // A blank circuit opens ready to edit: there's nothing to look at, so view
  // mode would only be one more click. Anything with parts opens view-only.
  const [editable, setEditable] = React.useState(() => doc.parts.length === 0)
  const startedEditing = React.useRef(editable)
  React.useEffect(() => {
    if (startedEditing.current) onEditChange?.(true)
    // mount only: tell the host we opened in edit mode, as the Edit button does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [view, setView] = React.useState<ViewId>('bb')
  const [grid, setGrid] = React.useState(true)
  const [sel, setSel] = React.useState<Selection>(emptySel())
  const [wireColor, setWireColor] = React.useState(WIRE_COLORS[0])
  const [cam, setCam] = React.useState<Cam>({ scale: 1, tx: 40, ty: 40 })
  // Breadboard and schematic each keep their own zoom and pan: switching back to
  // a view restores where you left it instead of re-fitting it.
  const camByView = React.useRef<Partial<Record<ViewId, Cam>>>({})
  const latestCam = React.useRef(cam)
  latestCam.current = cam
  const camView = React.useRef(view)
  React.useLayoutEffect(() => {
    if (camView.current === view) return
    camByView.current[camView.current] = latestCam.current
    camView.current = view
    const saved = camByView.current[view]
    if (saved) setCam(saved)
  }, [view])
  const [editorPart, setEditorPart] = React.useState<PartDef | null | undefined>(undefined)
  // packs in the dev tinyparts folder a Parts Editor save can target
  const [devPacks, setDevPacks] = React.useState<{ id: string; name: string }[]>()
  const [showPacks, setShowPacks] = React.useState(false)
  const [showErc, setShowErc] = React.useState(false)
  // Simulate is opened explicitly (the toolbar button) and only ever shows on
  // the schematic; Properties only shows while editing.
  const [simOpen, setSimOpen] = React.useState(false)
  const [railPref, setRailPref] = React.useState<RailTab>('properties')
  const [picking, setPicking] = React.useState(false)
  const [exportOpen, setExportOpen] = React.useState(false)
  const [sim, setSim] = React.useState<SimState>({ run: null, netlist: null })
  const [defsTick, bumpDefs] = React.useReducer((n: number) => n + 1, 0)
  const canvasRef = React.useRef<CanvasHandle>(null)
  // stage + export button anchor the capture animation; the chip is the
  // "download landed" affordance it flies into
  const stageRef = React.useRef<HTMLDivElement>(null)
  const exportBtnRef = React.useRef<HTMLButtonElement>(null)
  // {name, id}: the id re-arms the chip when the same file is exported twice
  const [savedFile, setSavedFile] = React.useState<{ name: string; id: number } | null>(null)
  const saveSeq = React.useRef(0)
  const [exporting, setExporting] = React.useState(false)

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

  // bring the parts layers up (cached packs, saved parts, the dev folder), then
  // lazy-load the defs this doc uses; saved parts must land first so custom
  // types resolve
  React.useEffect(() => {
    void initPartsLibrary().then(() => {
      const missing = doc.parts.map((p) => p.type).filter((t) => !getPart(t))
      if (missing.length) void ensureParts(missing).then(bumpDefs)
      else bumpDefs()
    })
  }, [doc.parts])

  // a part's source changed (an update from GitHub, art saved in the tinyparts
  // folder, a local edit reset): its old geometry is gone; reload what's used
  React.useEffect(
    () =>
      onPartsChanged((types) => {
        bumpDefs()
        const used = new Set(store.getDoc().parts.map((p) => p.type))
        const reload = types.filter((t) => used.has(t))
        if (reload.length) void ensureParts(reload).then(bumpDefs)
      }),
    [store]
  )

  // let whoever is editing art know their save landed
  React.useEffect(() => {
    let seenReload = getDevStatus().loadedAt
    let seenCommit = getSyncStatus().commit
    const offDev = onDevStatus(() => {
      const s = getDevStatus()
      if (!s.lastReload?.length || s.loadedAt === seenReload) return
      seenReload = s.loadedAt
      const packs = s.packs.filter((p) => s.lastReload!.includes(p.id))
      const names = packs.map((p) => p.name).join(', ')
      const issues = packs.flatMap((p) => [...p.errors, ...p.warnings])
      if (issues.length)
        toast.warning(
          `Reloaded ${names}, ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
          {
            description: issues.slice(0, 3).join('\n')
          }
        )
      else toast.success(`Reloaded ${names} from your tinyparts folder`)
    })
    const offSync = onSyncStatus(() => {
      const s = getSyncStatus()
      if (s.state !== 'ok' || s.commit === seenCommit) return
      seenCommit = s.commit
      if (s.updated.length)
        toast.info('Parts updated from tinyparts', { description: s.updated.join(', ') })
    })
    return () => {
      offDev()
      offSync()
    }
  }, [])

  React.useEffect(() => {
    if (editorPart === undefined || !devFolderActive()) return
    void devTargetPacks().then(setDevPacks)
  }, [editorPart])

  // The components rail draws each tile from the part's SCHEMATIC symbol when
  // the schematic is open, and symbols are generated from the part definition,
  // which is lazily loaded. Without this the rail fell back to `meta.icon`,
  // the Fritzing breadboard photo, so the schematic palette showed pictures of
  // components instead of symbols. Warm the whole catalogue once on entry.
  React.useEffect(() => {
    if (view !== 'sch') return
    let live = true
    void ensureParts(PART_MANIFEST.map((m) => m.type)).then(() => {
      if (live) bumpDefs()
    })
    return () => {
      live = false
    }
  }, [view])

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

  // sim results go stale the moment the circuit changes; drop them
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
  // per-net voltage lookup for the breadboard hole tooltip (M4 leftover):
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
  // are transparent; their row/rail buses still merge nets globally).
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

  // A migrated diagram.json has breadboard placements only, so the schematic
  // opened completely empty with everything sitting in the tray. If a view has
  // nothing placed at all but the document has parts for it, lay them out:
  // one undoable step, and only ever on an empty sheet, so this can't shuffle
  // a layout the user has arranged.
  const autoPlacedViews = React.useRef<Set<ViewId>>(new Set())
  React.useEffect(() => {
    if (!trayParts.length || autoPlacedViews.current.has(view)) return
    if (doc.parts.some((p) => p[view])) return // the view already has a layout
    autoPlacedViews.current.add(view)
    placeAllUnplacedIn(view)
  }, [view, trayParts, doc])

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

  // ── right rail visibility ───────────────────────────────────────────────────
  // Simulate: schematic only, and only once the user has asked for it.
  // Properties: editing only. Neither ⇒ no rail, canvas gets the full width.
  const showSim = simOpen && view === 'sch'
  const showProps = editable
  const railVisible = showSim || showProps
  const rail: RailTab = showSim && showProps ? railPref : showSim ? 'simulate' : 'properties'

  /** The Simulate button makes its own precondition true: schematic + panel. */
  const toggleSimulate = (): void => {
    if (showSim) {
      setSimOpen(false)
      setPicking(false)
      return
    }
    if (view !== 'sch') switchView('sch')
    setSimOpen(true)
    setRailPref('simulate')
    // start the ~20 MB engine download now so the first Run isn't a cold start
    void getSimBackend()
      .warmup()
      .catch(() => {
        /* surfaced in the panel's engine status, not as a toast */
      })
  }

  // picking is a mode of the open Simulate panel; it can't outlive it
  React.useEffect(() => {
    if (!showSim && picking) setPicking(false)
  }, [showSim, picking])

  // ── sim probes (CircuitLab-style measurement tags) ──────────────────────────
  // A picked output is a TAG on the sheet, not a highlight: it says what it
  // reads, it can be dragged, and it can be thrown away. doc.sim.probes is the
  // single source of truth: the Outputs list in the panel is a view of it.

  const probes = React.useMemo(() => doc.sim?.probes ?? [], [doc.sim])
  const nodeNames = React.useMemo(() => nodeNamesForNets(netModel), [netModel])

  /** Where a probe hangs off the circuit, in this view's world coordinates. */
  const anchorWorldOf = React.useCallback(
    (ref: string): Pt | null => {
      const a = probeAnchor(ref)
      if (!a) return null
      const part = doc.parts.find((p) => p.id === a.part)
      if (!part) return null
      if (a.pin) return pinWorldOf(part, a.pin, undefined, view)
      const pl = part[view]
      return pl ? { x: pl.x, y: pl.y } : null
    },
    // defsTick: pin geometry only exists once the part def has loaded
    [doc.parts, view, defsTick]
  )

  const labelOfProbe = React.useCallback(
    (p: Probe): string => {
      const a = probeAnchor(p.at)
      if (!a) return p.at
      if (a.kind === 'i') return `I(${a.part})`
      if (a.kind === 'd')
        return String(doc.parts.find((x) => x.id === a.part)?.attrs?.label ?? a.part)
      const idx = netModel.pinToNet.get(`${a.part}:${a.pin}`)
      return idx != null ? netLabelFor(netModel, idx, nodeNames) : a.part
    },
    [doc.parts, netModel, nodeNames]
  )

  /** A probe shows a number only when the run produced one (a DC operating
   * point); for a sweep the reading lives in the plot, not on the sheet. */
  const valueOfProbe = React.useCallback(
    (p: Probe): string | undefined => {
      if (!sim.run || sim.run.numPoints !== 1 || !sim.netlist) return undefined
      const name = vectorForOutput(p.at, netModel, sim.netlist)
      if (!name) return undefined
      const vec = sim.run.vectors.find((v) => v.name.toLowerCase() === name)
      if (!vec || vec.values.length !== 1) return undefined
      return fmtSI(vec.values[0], p.kind === 'current' ? 'A' : 'V')
    },
    [sim, netModel]
  )

  const probeTags = React.useMemo<ProbeTag[]>(() => {
    const out: ProbeTag[] = []
    for (const p of probes) {
      const anchor = anchorWorldOf(p.at)
      if (!anchor) continue // unplaced in this view; nothing to hang the tag on
      const [dx, dy] = p[view] ?? PROBE_DEFAULT_OFFSET
      out.push({
        id: p.id,
        ax: anchor.x,
        ay: anchor.y,
        x: anchor.x + dx,
        y: anchor.y + dy,
        label: labelOfProbe(p),
        value: valueOfProbe(p),
        kind: p.kind
      })
    }
    return out
  }, [probes, view, anchorWorldOf, labelOfProbe, valueOfProbe])

  /** Outputs the panel shows as picked: exactly what has a tag on the sheet. */
  const pickedOutputs = React.useMemo<OutputRef[]>(() => probes.map((p) => p.at), [probes])

  /** Add a tag for an output (or remove the one that is already there). */
  const toggleOutput = (ref: OutputRef, at?: Pt): void => {
    const existing = probeFor(store.getDoc().sim?.probes ?? [], ref)
    if (existing) {
      store.dispatch(cmd.removeProbe(existing.id))
      return
    }
    const anchor = at ? anchorWorldOf(ref) : null
    const offset: [number, number] =
      at && anchor
        ? [at.x - anchor.x + 6, at.y - anchor.y - 22]
        : ([...PROBE_DEFAULT_OFFSET] as [number, number])
    store.dispatch(cmd.addProbe(makeProbe(ref, view, offset)))
  }

  /** Canvas click in pick mode: drop a tag on that net, right where clicked. */
  const pickNetAt = (netIndex: number, at: Pt): void => {
    const ref = netOutputRefByIndex(netModel, netIndex)
    if (ref) toggleOutput(ref, at)
  }

  /** Tag dragged. A drop on a wire or pin re-anchors it to that node. */
  const moveProbeTo = (id: string, at: Pt, netIndex?: number): void => {
    const current = (store.getDoc().sim?.probes ?? []).find((p) => p.id === id)
    if (!current) return
    let ref = current.at
    if (netIndex != null) {
      const next = netOutputRefByIndex(netModel, netIndex)
      if (next) ref = next
    }
    const anchor = anchorWorldOf(ref)
    if (!anchor) return
    const offset: [number, number] = [at.x - anchor.x, at.y - anchor.y]
    store.dispatch(
      ref === current.at
        ? cmd.moveProbe(id, view, offset)
        : cmd.reanchorProbe(id, ref, offset, view)
    )
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

  /**
   * Placement for a part in the view the user is NOT looking at. Breadboards
   * never enter the schematic (spec §10.2; they're electrically transparent
   * there), so they get no counterpart placement; everything else does, which
   * is what keeps the tray empty for parts the user just added.
   */
  const counterpartPlacement = (type: string, other: ViewId): Placement | undefined => {
    if (other === 'sch' && isBreadboard(type)) return undefined
    return autoPlacementFor(store.getDoc(), type, other)
  }

  const addPartAt = async (type: string, at?: Pt): Promise<void> => {
    const def = getPart(type) || (await loadPart(type))
    if (!def) return
    bumpDefs()
    const p = at ?? canvasRef.current?.centerWorld() ?? { x: 300, y: 200 }
    const id = nextRefdes(
      store.getDoc(),
      prefixForFamily(`${def.simFamily ?? def.family ?? ''} ${def.type}`, def.prefix)
    )
    const attrs = simSourceDefaultAttrs(type) ?? simProbeDefaultAttrs(type) ?? defaultAttrsFor(type)
    // The part lands where the user dropped it in this view, and auto-places
    // (collision-avoided) in the other one: add an LED on the breadboard and
    // its symbol is already sitting on the schematic.
    const other: ViewId = view === 'bb' ? 'sch' : 'bb'
    const placements: Partial<Record<ViewId, Placement>> = {
      [view]: findFreePlacement(store.getDoc(), type, view, p)
    }
    const counterpart = counterpartPlacement(type, other)
    if (counterpart) placements[other] = counterpart
    store.dispatch(cmd.addPart({ id, type, ...(attrs ? { attrs } : {}), ...placements }))
    setSel({ parts: new Set([id]), wires: new Set() })
  }

  /**
   * Refdes prefix for a type. Prefers the loaded part definition (a pack can
   * declare its own), and falls back to the static naming table so this works
   * before a part's JSON has been lazily loaded.
   */
  const prefixForType = React.useCallback((type: string): string => {
    const def = getPart(type)
    const naming = resolveNaming(type, def?.label, def?.simFamily ?? def?.family)
    return prefixForFamily(`${naming.sim} ${type}`, def?.prefix ?? naming.prefix)
  }, [])

  /** True when the document still carries part-file slugs as reference designators
   * (`led`, `battery-aa_y90`): what a migrated v1 diagram.json leaves behind. */
  const needsRenumber = React.useMemo(() => doc.parts.some((p) => looksLikeSlug(p.id)), [doc.parts])

  /** Rewrite every part id to a conventional refdes (R1, C2, LED3…). */
  const renumber = (): void => {
    const mapping = renumberAll(store.getDoc(), prefixForType, view)
    const n = Object.keys(mapping).length
    if (!n) {
      toast.info('Reference designators are already in order.')
      return
    }
    store.dispatch(cmd.renumberParts(mapping))
    setSel(emptySel())
    toast.success(`Renumbered ${n} part${n > 1 ? 's' : ''}`, {
      description: Object.entries(mapping)
        .slice(0, 3)
        .map(([from, to]) => `${from} → ${to}`)
        .join(' · ')
    })
  }

  /** Auto-place every part missing from a view, in one undo step. */
  const placeAllUnplacedIn = (target: ViewId, select = false): void => {
    const current = store.getDoc()
    const missing = current.parts.filter(
      (p) => !p[target] && (target === 'bb' ? p.sch : p.bb && !isBreadboard(p.type))
    )
    if (!missing.length) return
    let next = current
    const steps: cmd.Command[] = []
    for (const part of missing) {
      const step = cmd.placePart(part.id, target, autoPlacementFor(next, part.type, target))
      steps.push(step)
      next = step.apply(next)
    }
    store.dispatch(cmd.composite(`Place ${steps.length} part${steps.length > 1 ? 's' : ''}`, steps))
    if (select) {
      setSel({ parts: new Set(missing.map((p) => p.id)), wires: new Set(), labels: new Set() })
      enterEdit()
    }
  }

  const placeAllUnplaced = (): void => placeAllUnplacedIn(view, true)

  // .fzpz dropped on the canvas: convert → persist → place at the cursor
  const importFzpzFiles = async (files: File[], at: Pt): Promise<void> => {
    for (const f of files) {
      try {
        const { def, warnings } = await importFzpz(new Uint8Array(await f.arrayBuffer()), f.name)
        await saveUserPart(def)
        bumpDefs()
        await addPartAt(def.type, at)
        // saveUserPart registers it, which is where naming/categorisation is
        // applied; report the display name, not the raw Fritzing title.
        const shown = getPart(def.type) ?? def
        toast.success(`Imported ${shown.label}`, {
          description: warnings.length
            ? `${warnings.length} pin${warnings.length === 1 ? '' : 's'} could not be resolved`
            : `${shown.family} · now in the palette`
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

  // ── image export ────────────────────────────────────────────────────────────
  // Render first, play the shutter/fly-to-corner animation against the real
  // image, then hand the blob to the browser, so the download shows up right
  // where the animation lands.
  const savePng = React.useCallback(async (): Promise<void> => {
    if (exporting) return
    setExporting(true)
    try {
      const shot = await renderPng(doc, view)
      if (!shot) {
        toast.error('Nothing to export: this view is empty.')
        return
      }
      await playCaptureAnimation({
        stage: stageRef.current,
        target: exportBtnRef.current,
        imageUrl: shot.previewUrl
      })
      saveImage(shot)
      setSavedFile({ name: shot.name, id: ++saveSeq.current })
    } catch (err) {
      reportError('PNG export failed', err)
    } finally {
      setExporting(false)
    }
  }, [doc, view, exporting])

  const saveSvg = React.useCallback((): void => {
    try {
      const shot = exportSvg(doc, view)
      if (!shot) {
        toast.error('Nothing to export: this view is empty.')
        return
      }
      setSavedFile({ name: shot.name, id: ++saveSeq.current })
    } catch (err) {
      reportError('SVG export failed', err)
    }
  }, [doc, view])

  // the download chip is transient
  const savedId = savedFile?.id
  React.useEffect(() => {
    if (!savedId) return
    const t = setTimeout(() => setSavedFile(null), 3600)
    return () => clearTimeout(t)
  }, [savedId])

  const tool =
    'tactile-outline h-8 px-2.5 flex items-center gap-1.5 rounded-md bg-surface-card text-text-muted text-xs hover:text-text-body'
  // filled actions, matching the Upload button in the main toolbar: green for
  // "run it", brand blue for "take it away with you"
  const toolFilled =
    'tactile h-8 px-2.5 flex items-center gap-1.5 rounded-md text-white text-xs font-medium'
  const toolGreen = `${toolFilled} bg-[var(--green)] [--_edge:var(--green-deep)]`
  const toolBrand = `${toolFilled} bg-[var(--brand)] [--_edge:var(--brand-deep)]`
  // The toolbar follows the stage's own width (a container query), so it also
  // makes room when the palette or the right rail opens. Wide: icons and
  // labels. Under 700px: icons only. Under 420px: the corner groups turn into
  // columns so they never run into the Breadboard | Schematic switch.
  const noLabel = '@max-[700px]:hidden'
  const iconOnly = '@max-[700px]:w-8 @max-[700px]:justify-center @max-[700px]:px-0'
  const stack = '@max-[420px]:flex-col'

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

      <div ref={stageRef} className="@container flex-1 relative min-w-0 overflow-hidden flex">
        {/* left toolbar: edit toggle + undo/redo */}
        <div className={`absolute top-3 left-3 z-10 flex gap-1.5 ${stack}`}>
          <button
            className={`${tool} ${iconOnly} ${editable ? 'text-brand' : ''}`}
            onClick={() => {
              const next = !editable
              setEditable(next)
              setSel(emptySel())
              onEditChange?.(next)
            }}
            aria-pressed={editable}
            title={editable ? 'Stop editing (view only)' : 'Edit the circuit'}
            aria-label={editable ? 'Done editing' : 'Edit'}
          >
            {editable ? <Eye size={15} /> : <Pencil size={15} />}
            <span className={noLabel}>{editable ? 'Done' : 'Edit'}</span>
          </button>
          {editable && (
            <>
              <button
                className={`${tool} w-8 justify-center px-0 disabled:opacity-40`}
                disabled={!store.canUndo()}
                onClick={() => store.undo()}
                title={`${store.undoLabel() ? `Undo ${store.undoLabel()}` : 'Undo'} (${keysOf('circuit.undo')})`}
              >
                <Undo2 size={15} />
              </button>
              <button
                className={`${tool} w-8 justify-center px-0 disabled:opacity-40`}
                disabled={!store.canRedo()}
                onClick={() => store.redo()}
                title={`Redo (${keysOf('circuit.redo')})`}
              >
                <Redo2 size={15} />
              </button>
            </>
          )}
          <button
            className={`${tool} w-8 justify-center px-0 ${grid ? 'text-brand' : ''}`}
            onClick={() => setGrid((g) => !g)}
            title="Toggle grid"
          >
            <Grip size={15} />
          </button>
        </div>

        {/* view toggle: Breadboard | Schematic */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex rounded-md overflow-hidden tactile-bordered">
          {(
            [
              ['bb', 'Breadboard', CircuitBoard],
              ['sch', 'Schematic', Cpu]
            ] as [ViewId, string, typeof Cpu][]
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              title={label}
              aria-label={label}
              className={`h-8 px-3 flex items-center text-xs font-medium @max-[700px]:w-9 @max-[700px]:justify-center @max-[700px]:px-0 ${
                view === v
                  ? 'bg-brand/15 text-brand'
                  : 'bg-surface-card text-text-muted hover:text-text-body'
              }`}
              onClick={() => switchView(v)}
            >
              <Icon size={15} className="hidden @max-[700px]:block" />
              <span className={noLabel}>{label}</span>
            </button>
          ))}
        </div>

        {/* unplaced tray: parts that only exist in the other view */}
        {trayParts.length > 0 && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 z-10 flex gap-1.5 items-center flex-wrap max-w-[70%] justify-center">
            <span className="text-[10px] text-text-faint">unplaced here:</span>
            {trayParts.length > 1 && (
              <button
                className="px-2 py-0.5 rounded-full bg-brand/15 border border-brand/40 text-[11px] text-brand hover:bg-brand/25"
                title="Auto-place every unplaced part in this view"
                onClick={placeAllUnplaced}
              >
                place all
              </button>
            )}
            {trayParts.map((part) => (
              <button
                key={part.id}
                className="px-2 py-0.5 rounded-full bg-surface-card border border-dashed border-border-strong text-[11px] text-text-body hover:border-brand hover:text-brand"
                title={`${part.type}: click to place it in this view`}
                onClick={() => placeFromTray(part.id)}
              >
                {part.id}
              </button>
            ))}
          </div>
        )}

        {/* right toolbar: simulate · export · code */}
        <div className={`absolute top-3 right-3.5 z-30 flex gap-1.5 ${stack}`}>
          <button
            className={`${toolGreen} ${iconOnly} ${showSim ? 'ring-2 ring-[var(--green-deep)]' : ''}`}
            onClick={toggleSimulate}
            title={
              showSim
                ? 'Close the simulator'
                : 'Simulate this circuit (experimental): opens the schematic and the Simulate panel'
            }
          >
            <Play size={14} />
            <span className={noLabel}>Simulate</span>
          </button>

          {/* one export control, two formats; the two icon buttons that used
              to sit here read as unrelated actions */}
          <div className="relative">
            <button
              ref={exportBtnRef}
              className={`${toolBrand} ${iconOnly} disabled:opacity-60`}
              disabled={exporting}
              onClick={() => setExportOpen((o) => !o)}
              title="Export this view as an image"
              aria-label="Export"
            >
              <Share size={14} />
              <span className={noLabel}>Export</span>
              <ChevronDown size={13} className={`-ml-0.5 opacity-80 ${noLabel}`} />
            </button>
            {exportOpen && (
              <>
                {/* click-away catcher */}
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-9 z-20 w-40 rounded-md border border-border-default bg-surface-card shadow-lg overflow-hidden">
                  <button
                    className="w-full flex items-center gap-2 px-3 h-8 text-xs text-text-body hover:bg-bg-sunken"
                    onClick={() => {
                      setExportOpen(false)
                      void savePng()
                    }}
                  >
                    <ImageDown size={14} className="text-brand" /> PNG image
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 h-8 text-xs text-text-body hover:bg-bg-sunken"
                    onClick={() => {
                      setExportOpen(false)
                      saveSvg()
                    }}
                  >
                    <FileCode2 size={14} className="text-brand" /> SVG vector
                  </button>
                </div>
              </>
            )}
          </div>

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

        {/* download chip: the animation lands here, then this confirms it */}
        {savedFile && <DownloadChip key={savedFile.id} name={savedFile.name} />}

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
            {needsRenumber && (
              <button
                className="px-2.5 py-1 rounded-full bg-surface-card border border-brand/40 text-brand flex items-center gap-1.5 hover:bg-brand/10"
                title="Rename parts to conventional reference designators (R1, C2, D3…); the ids an imported diagram.json left behind are part-file slugs"
                onClick={renumber}
              >
                <ListOrdered size={12} /> renumber refdes
              </button>
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
          fitOnMount={!camByView.current[view]}
          handleRef={canvasRef}
          onDropPart={(type, at) => void addPartAt(type, at)}
          onDropNetLabel={(kind, name, at) => addNetLabel(kind, name, at)}
          onImportFiles={(files, at) => void importFzpzFiles(files, at)}
          annotations={simAnnotations}
          simVoltageForNet={simVoltageForNet}
          pickNets={picking && showSim}
          onPickNet={pickNetAt}
          probes={probeTags}
          onMoveProbe={moveProbeTo}
          onDeleteProbe={(id) => store.dispatch(cmd.removeProbe(id))}
          onRequestEdit={enterEdit}
        />

        {/* watermark: matches the header wordmark: thin 'tiny', bold 'Studio' */}
        <div className="absolute bottom-16 right-5 z-0 pointer-events-none select-none max-w-full truncate text-[46px] leading-[1.15] pb-1 tracking-[-0.02em] text-text-faint/25">
          <span className="font-light">tiny</span>
          <span className="font-extrabold">Studio</span>
        </div>
      </div>

      {/* Right rail. Properties is an editing tool and Simulate is a
          schematic tool, so the rail only exists when one of them applies;
          the breadboard in view-only mode has no sidebar at all. */}
      {railVisible && (
        <div
          className={`${showSim ? 'w-80' : 'w-64'} shrink-0 min-h-0 relative z-20 border-l border-border-default bg-bg-raised flex flex-col`}
        >
          {showSim && showProps ? (
            <div className="h-9 shrink-0 flex items-stretch border-b border-border-default">
              {(
                [
                  ['properties', 'Properties'],
                  ['simulate', 'Simulate']
                ] as [RailTab, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={`flex-1 text-[12px] font-semibold border-b-2 -mb-px ${
                    rail === id
                      ? 'border-brand text-text-body'
                      : 'border-transparent text-text-muted hover:text-text-body'
                  }`}
                  onClick={() => setRailPref(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-border-default">
              <span className="text-[12px] font-semibold text-text-body">
                {showSim ? 'Simulate' : 'Properties'}
              </span>
              {showSim && (
                <button
                  className="ml-auto text-text-faint hover:text-text-body"
                  onClick={() => {
                    setSimOpen(false)
                    setPicking(false)
                  }}
                  title="Close the simulator"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
          {rail === 'properties' ? (
            <InspectorRail
              doc={doc}
              store={store}
              sel={sel}
              setSel={setSel}
              netModel={netModel}
              view={view}
              editable={editable}
              onRenumber={renumber}
            />
          ) : (
            <SimPanel
              variant="rail"
              doc={doc}
              netModel={netModel}
              store={store}
              familyOf={(t) => getPart(t)?.simFamily ?? getPart(t)?.family}
              onClose={() => {
                setSimOpen(false)
                setPicking(false)
              }}
              onResult={setSim}
              onSelectIssue={selectSimIssue}
              picking={picking}
              onPickingChange={setPicking}
              picked={pickedOutputs}
              onToggleOutput={(ref) => toggleOutput(ref)}
              onClearOutputs={() => store.dispatch(cmd.setProbes([]))}
            />
          )}
        </div>
      )}

      {editorPart !== undefined && (
        <PartsEditor
          initial={editorPart}
          localEdit={!!editorPart && isLocalEdit(editorPart.type)}
          onReset={
            editorPart
              ? async () => {
                  await resetUserPart(editorPart.type)
                  setEditorPart(undefined)
                  toast.success(`${editorPart.label} is back to the shipped version`)
                }
              : undefined
          }
          folderPacks={devPacks}
          onClose={() => setEditorPart(undefined)}
          onSave={async (def: PartDef) => {
            await saveUserPart(def)
            bumpDefs()
            setEditorPart(undefined)
            toast.success(`Saved ${def.label} on this computer`, {
              description: isLocalEdit(def.type)
                ? 'Only this computer sees this change. Reset it any time from the Parts editor or Parts Packs.'
                : 'It’s in your components rail.'
            })
          }}
          onSaveToFolder={
            devFolderActive()
              ? async (def, info, pack) => {
                  try {
                    const dir = await savePartToFolder({ pack, def, ...info })
                    bumpDefs()
                    setEditorPart(undefined)
                    toast.success(`Saved ${def.label} to tinyparts`, {
                      description: `${dir}: commit and push tinyparts to share it`,
                      // revealing a folder needs the desktop app
                      action: window.api?.fs
                        ? { label: 'Show', onClick: () => void window.api.fs.showInFolder(dir) }
                        : undefined
                    })
                  } catch (e) {
                    toast.error('Couldn’t save to tinyparts', {
                      description: e instanceof Error ? e.message : String(e)
                    })
                  }
                }
              : undefined
          }
        />
      )}

      {showPacks && (
        <PackManager onClose={() => setShowPacks(false)} onInstalled={() => bumpDefs()} />
      )}
    </div>
  )
}

/**
 * The little "saved" chip that pops in under the export button: the landing
 * pad the capture animation flies into, so the download has somewhere to be.
 */
function DownloadChip({ name }: { name: string }): React.JSX.Element {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    el.animate(
      [
        { opacity: 0, transform: 'translateY(-8px) scale(0.9)' },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.35 },
        { opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.85 },
        { opacity: 0, transform: 'translateY(-4px) scale(0.98)' }
      ],
      { duration: 3600, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' }
    )
  }, [name])
  return (
    <div
      ref={ref}
      className="absolute top-[52px] right-3.5 z-20 pointer-events-none flex items-center gap-1.5 rounded-md bg-surface-card border border-border-default shadow-lg px-2.5 h-8 text-[11px] text-text-body"
    >
      <Download size={13} className="text-brand" />
      <span className="font-medium">{name}</span>
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
