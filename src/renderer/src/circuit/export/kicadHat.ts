/**
 * circuit/export/kicadHat: a circuit built on a tinyCore, as a KiCad HAT project.
 *
 * The tinyProto is where a circuit gets tried out; a HAT is where it ends up.
 * This writes a ready KiCad 10 project for that HAT:
 *
 *   <name>.kicad_sch  the circuit as a schematic (export/kicadSch): KiCad's own
 *                     symbols, net labels, the tinyCore as the three headers
 *   <name>.kicad_pcb  the blank HAT (export/hatTemplate, from tinyMove): the
 *                     octagon outline, no mounting holes, the tinyCore headers
 *                     J1/J2/J3 in place with their pads already on the
 *                     circuit's nets, and tinyMove's board setup and rules
 *   <name>.net        the circuit's netlist, with the tinyCore exported as
 *                     those three headers, so every part lands wired to the
 *                     right header pin
 *   <name>.kicad_pro  the project, with tinyMove's design rules
 *   fp-lib-table      KiCad's own footprint libraries the parts use (a
 *   sym-lib-table     through-hole capacitor, a 6 mm button) and symbol
 *                     libraries the schematic uses, so they resolve even where
 *                     the global library tables leave them out
 *   README.txt        the steps left: update the board, place the parts
 *
 * The headers on the board are linked to their schematic symbols, so "Update
 * PCB from Schematic" brings every part in beside the HAT with its ratsnest
 * drawn to the headers (importing the .net does the same, for anyone who'd
 * rather not use the schematic).
 *
 * The board and the project are the user's once they've opened them: an export
 * into a folder that already has them leaves them alone (see keepIfExists) and
 * only rewrites the schematic, netlist and README.
 */

import type { CircuitDoc } from '../core/model'
import type { NetModel } from '../core/nets'
import { today, type ExportContext } from './common'
import { HAT_EDGE_CUTS, HAT_HEADERS, HAT_PCB_HEAD, HAT_PRO } from './hatTemplate'
import { type StandIn } from './kicadNetlist'
import { kicadSchematic, stableUuid } from './kicadSch'
import { boardTransform, placeFootprints, type Pt } from './kicadPlace'

/** tinyCore header pins, pad by pad, as the HAT template numbers them. */
export const TINYCORE_HAT_HEADERS: {
  ref: 'J1' | 'J2' | 'J3'
  footprint: string
  symbol: string
  pins: string[]
}[] = [
  {
    ref: 'J1',
    footprint: 'SparkFun-Connector:1x08_P2.54mm',
    symbol: 'SparkFun-Connector:Conn_01x08_P2.54mm',
    pins: ['GND', '3V3', 'A5', 'A4', 'A3', 'A2', 'A1', 'A0']
  },
  {
    ref: 'J2',
    footprint: 'SparkFun-Connector:1x08_P2.54mm',
    symbol: 'SparkFun-Connector:Conn_01x08_P2.54mm',
    pins: ['GND.2', '3V3.2', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8']
  },
  {
    ref: 'J3',
    footprint: 'SparkFun-Connector:1x09_P2.54mm',
    symbol: 'SparkFun-Connector:Conn_01x09_P2.54mm',
    pins: ['SCK', 'MO', 'MI', 'RX', 'TX', 'SDA', 'SCL', 'PWR', 'GND.3']
  }
]

/** Net names for header pins whose part.json name isn't the familiar one. */
const HEADER_NET_NAME: Record<string, string> = { MO: 'MOSI', MI: 'MISO' }

export interface HatProject {
  /** file name → contents, ready for zipFiles */
  files: Record<string, string>
  /** files to write only if they aren't there yet: the board and project, which the user lays out and configures */
  keepIfExists: string[]
  warnings: string[]
}

/** A file name from whatever the user called the project. */
export function hatFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'tinyHAT'
  )
}

const escapeKicad = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

export function kicadHatProject(
  doc: CircuitDoc,
  net: NetModel,
  ctx: ExportContext = {},
  title = 'tinyHAT',
  opts: { company?: string; designer?: string; revision?: string } = {}
): HatProject {
  const name = hatFileName(title)
  const warnings: string[] = []
  const cores = doc.parts.filter((p) => p.type === 'tinycore')
  if (!cores.length)
    warnings.push('No tinyCore in this circuit: the HAT headers are exported unconnected.')
  if (cores.length > 1)
    warnings.push(`${cores.length} tinyCores: only ${cores[0].id} becomes the HAT's headers.`)

  // the headers take J1-J3 unless the circuit already uses those names
  const taken = new Set(doc.parts.map((p) => p.id))
  let next = 101
  const refOf = new Map<string, string>()
  for (const h of TINYCORE_HAT_HEADERS) {
    let ref: string = h.ref
    while (taken.has(ref)) ref = `J${next++}`
    taken.add(ref)
    refOf.set(h.ref, ref)
  }

  const standIns = new Map<string, StandIn[]>()
  const headerComps: StandIn[] = TINYCORE_HAT_HEADERS.map((h) => ({
    ref: refOf.get(h.ref)!,
    footprint: h.footprint,
    symbol: h.symbol,
    // the header part the template carries (PPTC081LFBN-RC), and which one it is
    value: /\(property "Value" "((?:[^"\\]|\\.)*)"/.exec(HAT_HEADERS[h.ref])?.[1] ?? 'Conn',
    description: `tinyCore ${h.ref === 'J1' ? 'left' : h.ref === 'J2' ? 'right' : 'bottom'} header`,
    pads: Object.fromEntries(h.pins.map((pin, i) => [pin, String(i + 1)])),
    // power pins are on their rail whether this circuit uses them or not
    fixed: Object.fromEntries(
      h.pins.flatMap((pin, i) =>
        /^(GND|3V3)(\.\d+)?$/.test(pin) ? [[String(i + 1), pin.replace(/\.\d+$/, '')]] : []
      )
    ),
    // a net on a header pin is named for it: "D8", not "Net-(J2-Pad8)"
    names: Object.fromEntries(h.pins.map((pin, i) => [String(i + 1), HEADER_NET_NAME[pin] ?? pin]))
  }))
  if (cores[0]) standIns.set(cores[0].id, headerComps)
  else
    // no board: the headers still go into the netlist, so they import too
    standIns.set('\u0000no-board', headerComps)

  const revision = opts.revision ?? 'v0.1'
  const designer = opts.designer ?? doc.meta?.author
  const sch = kicadSchematic(doc, net, ctx, {
    name,
    title,
    standIns,
    company: opts.company,
    designer,
    revision
  })
  const netlist = sch.netlist
  warnings.push(...sch.warnings)

  // the board: template head, outline, headers with their pads' nets filled in
  const headers = TINYCORE_HAT_HEADERS.map((h) => {
    const ref = refOf.get(h.ref)!
    let text = HAT_HEADERS[h.ref].replace(
      /\(property "Reference" "J[123]"/,
      `(property "Reference" "${ref}"`
    )
    const desc = headerComps.find((c) => c.ref === ref)?.description ?? ''
    text = text.replace(
      /\(property "Description" "(?:[^"\\]|\\.)*"/,
      `(property "Description" "${escapeKicad(desc)}"`
    )
    text = text.replace(/\n(\t+)\{\{NET_(\d+)\}\}/g, (_m, indent: string, pad: string) => {
      const n = netlist.padNets.get(`${ref}:${pad}`)
      return n ? `\n${indent}(net "${escapeKicad(n)}")` : ''
    })
    // link the footprint to its schematic symbol, so Update PCB from Schematic
    // keeps it (and its nets) instead of adding a second J1
    text = text.replace(
      /(\n(\t+)\(property ki_fp_filters "[^"]*"\))/,
      (_m, line: string, indent: string) =>
        `${line}\n${indent}(path "/${sch.symbolUuids.get(ref)}")` +
        `\n${indent}(sheetname "/")\n${indent}(sheetfile "${escapeKicad(name)}.kicad_sch")`
    )
    return text
  })
  // the parts, where they sit on the tinyProto (export/kicadPlace)
  const outline = hatOutline()
  const core = cores[0]
  const gndPx = core && ctx.pinAt?.(core.id, 'GND')
  const d8Px = core && ctx.pinAt?.(core.id, 'D8')
  const toBoard =
    gndPx && d8Px
      ? boardTransform({ px: gndPx, mm: HAT_PAD_GND }, { px: d8Px, mm: HAT_PAD_D8 })
      : null
  const { placed, warnings: placeWarnings } = placeFootprints({
    name,
    comps: netlist.components,
    padNets: netlist.padNets,
    symbolUuids: sch.symbolUuids,
    pinAt: (id, pin) => ctx.pinAt?.(id, pin) ?? null,
    toBoard,
    outline
  })
  warnings.push(...placeWarnings)

  const uid = (what: string): string => stableUuid(`${name}:pcb:${what}`)
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const top = Math.min(...ys) + 2.4
  const boardText = [
    // the board's name on the silk (SLK-400), its version in bottom copper (SLK-405)
    `\t(gr_text ${q(title.trim() || 'tinyHAT')}\n\t\t(at ${f(cx)} ${f(top)} 0)\n\t\t(layer "F.SilkS")\n` +
      `\t\t(uuid ${q(uid('name'))})\n\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)`,
    `\t(gr_text ${q(revision)}\n\t\t(at ${f(cx)} ${f(top)} 0)\n\t\t(layer "B.Cu" knockout)\n` +
      `\t\t(uuid ${q(uid('version'))})\n\t\t(effects (font (size 1 1) (thickness 0.25)) (justify mirror))\n\t)`
  ]
  // GND pours on both sides, 8 mil clearance, thermal reliefs (LAY-304)
  const hasGnd = [...netlist.padNets.values()].includes('GND')
  const zones = hasGnd
    ? ['F.Cu', 'B.Cu'].map(
        (layer) =>
          `\t(zone\n\t\t(net "GND")\n\t\t(layer ${q(layer)})\n\t\t(uuid ${q(uid(`zone:${layer}`))})\n` +
          `\t\t(hatch edge 0.5)\n\t\t(connect_pads\n\t\t\t(clearance 0.2032)\n\t\t)\n\t\t(min_thickness 0.254)\n` +
          `\t\t(fill yes\n\t\t\t(thermal_gap 0.508)\n\t\t\t(thermal_bridge_width 0.508)\n\t\t\t(island_removal_mode 0)\n\t\t)\n` +
          `\t\t(polygon\n\t\t\t(pts\n\t\t\t\t${outline.map((p) => `(xy ${f(p.x)} ${f(p.y)})`).join(' ')}\n\t\t\t)\n\t\t)\n\t)`
      )
    : []

  const head = HAT_PCB_HEAD.replace('{{TITLE}}', escapeKicad(title.trim() || 'tinyHAT'))
    .replace('{{DATE}}', today(ctx))
    // the title block matches the schematic's (LAY-120)
    .replace(
      /\n\t\t\(rev "[^"]*"\)\n\t\t\(company "[^"]*"\)\n\t\t\(comment 1 "[^"]*"\)/,
      `\n\t\t(rev ${q(revision)})` +
        (opts.company ? `\n\t\t(company ${q(opts.company)})` : '') +
        `\n\t\t(comment 1 ${q(designer ? `Designed by: ${designer}` : 'Exported from tinyStudio')})`
    )
  const pcb =
    head +
    HAT_EDGE_CUTS +
    headers.join('') +
    placed.map((p) => '\n' + p.text).join('') +
    '\n' +
    [...boardText, ...zones].join('\n') +
    '\n)\n'

  // footprints from KiCad's own libraries (everything that isn't SparkFun's)
  const stockLibs = [
    ...new Set(
      netlist.components
        .map((c) => c.footprint.split(':')[0])
        .filter((lib) => lib && !lib.startsWith('SparkFun-'))
    )
  ].sort()

  const readme = [
    `${title.trim() || 'tinyHAT'}: a tinyCore HAT, exported from tinyStudio`,
    '',
    'Open ' + `${name}.kicad_pro` + ' in KiCad 10, then:',
    '',
    `1. Open the schematic (${name}.kicad_sch): every part, with net labels for its`,
    '   connections and the tinyCore drawn as its three headers (J1-J3). Run ERC if',
    '   you like; tidy the layout as much as you want.',
    `2. Open the board (${name}.kicad_pcb). The HAT outline, the three tinyCore`,
    '   headers and every part are already there, on their nets: each part where',
    "   it sits on the tinyProto (parts that aren't on it are lined up below the",
    '   board). GND pours fill both sides; press B to fill them.',
    '3. Tidy the placement (no mounting holes: the HAT clips onto the tinyCore by',
    '   its headers), route (6 mil signals, 10 mil power, 45 degree bends), and run',
    '   DRC. docs/hardware-standards.md in tinyStudio has the full checklist.',
    '4. After changing the circuit, export again and run Tools > Update PCB from',
    '   Schematic to bring the changes onto your layout.',
    '',
    'Exporting again from tinyStudio rewrites the schematic, netlist and this',
    'README, and leaves the board and project alone, so a layout is never lost.',
    '',
    'Footprints come from the SparkFun KiCad libraries (and KiCad stock ones for a',
    'few through-hole parts); add the SparkFun libraries in KiCad if pcbnew reports',
    'a footprint it cannot find.',
    ...(warnings.length ? ['', 'Export notes:', ...warnings.map((w) => `  - ${w}`)] : []),
    ''
  ].join('\n')

  return {
    files: {
      [`${name}/${name}.kicad_pro`]: hatProjectFile(name, sch.sheetUuid),
      [`${name}/${name}.kicad_sch`]: sch.text,
      [`${name}/${name}.kicad_pcb`]: pcb,
      [`${name}/${name}.net`]: netlist.text,
      [`${name}/README.txt`]: readme,
      ...(stockLibs.length ? { [`${name}/fp-lib-table`]: fpLibTable(stockLibs) } : {}),
      ...(sch.symbolLibs.length ? { [`${name}/sym-lib-table`]: symLibTable(sch.symbolLibs) } : {})
    },
    keepIfExists: [
      `${name}/${name}.kicad_pro`,
      `${name}/${name}.kicad_pcb`,
      `${name}/fp-lib-table`,
      `${name}/sym-lib-table`
    ],
    warnings
  }
}

/**
 * The .kicad_pro: tinyMove's settings, pointed at this project's schematic (its
 * one top-level sheet, by the uuid the .kicad_sch carries) with tinyMove's own
 * sheet, designator history and drawing-sheet file taken out.
 */
export function hatProjectFile(name: string, sheetUuid: string): string {
  const pro = JSON.parse(HAT_PRO.replace('{{NAME}}', name))
  pro.schematic.top_level_sheets = [{ filename: `${name}.kicad_sch`, name, uuid: sheetUuid }]
  pro.schematic.used_designators = ''
  pro.schematic.page_layout_descr_file = ''
  // track widths 6/10/22/50 mil, vias 24/12 mil, power nets 10 mil (LAY-300, -303)
  const ds = pro.board.design_settings
  ds.drc_exclusions = []
  ds.track_widths = [0, 0.1524, 0.254, 0.5588, 1.27]
  ds.via_dimensions = [
    { diameter: 0, drill: 0 },
    { diameter: 0.6096, drill: 0.3048 }
  ]
  const classes = pro.net_settings.classes as Record<string, unknown>[]
  const base = classes.find((c) => c.name === 'Default')!
  Object.assign(base, { track_width: 0.1524, via_diameter: 0.6096, via_drill: 0.3048 })
  pro.net_settings.classes = [
    ...classes.filter((c) => c.name !== 'Power'),
    { ...base, name: 'Power', priority: 0, track_width: 0.254 }
  ].map((c) => (c.name === 'All Nets' ? { ...c, priority: 1 } : c))
  pro.net_settings.netclass_patterns = ['GND', '3V3', 'PWR', 'VBUS', 'VIN', '5V'].map(
    (pattern) => ({ netclass: 'Power', pattern })
  )
  return JSON.stringify(pro, null, 2) + '\n'
}

/**
 * A project footprint-library table for the stock KiCad libraries the parts
 * use, by KiCad 10's own footprint folder: a project entry wins over a global
 * one of the same name, and points at the same files where both exist.
 */
export function fpLibTable(libs: string[]): string {
  return [
    '(fp_lib_table',
    '\t(version 7)',
    ...libs.map(
      (lib) =>
        `\t(lib (name "${escapeKicad(lib)}") (type "KiCad") (uri "\${KICAD10_FOOTPRINT_DIR}/${escapeKicad(lib)}.pretty") (options "") (descr "KiCad stock library, added by tinyStudio"))`
    ),
    ')',
    ''
  ].join('\n')
}

/** The same for symbols: the stock symbol libraries, by KiCad 10's own symbol folder. */
export function symLibTable(libs: string[]): string {
  return [
    '(sym_lib_table',
    '\t(version 7)',
    ...libs.map(
      (lib) =>
        `\t(lib (name "${escapeKicad(lib)}") (type "KiCad") (uri "\${KICAD10_SYMBOL_DIR}/${escapeKicad(lib)}.kicad_sym") (options "") (descr "KiCad stock library, added by tinyStudio"))`
    ),
    ')',
    ''
  ].join('\n')
}

const f = (n: number): string => String(Math.round(n * 1e6) / 1e6)
const q = (s: string): string => `"${escapeKicad(s)}"`

/** Where the HAT template puts the tinyCore's GND (J1 pad 1) and D8 (J2 pad 8). */
const HAT_PAD_GND: Pt = { x: 126.259995, y: 96.137275 }
const HAT_PAD_D8: Pt = { x: 170.759995, y: 96.117275 }

/** The HAT's outline, corner by corner, from the template's Edge.Cuts lines. */
export function hatOutline(): Pt[] {
  const pts: Pt[] = []
  for (const m of HAT_EDGE_CUTS.matchAll(/\((?:start|end) ([-\d.]+) ([-\d.]+)\)/g)) {
    const p = { x: +m[1], y: +m[2] }
    if (!pts.some((o) => Math.hypot(o.x - p.x, o.y - p.y) < 1e-3)) pts.push(p)
  }
  const c = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length
  }
  return pts.sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x))
}
