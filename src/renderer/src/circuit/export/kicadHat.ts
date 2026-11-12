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
import { kicadSchematic } from './kicadSch'

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
  title = 'tinyHAT'
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
    value: `tinyCore ${h.ref === 'J1' ? 'left' : h.ref === 'J2' ? 'right' : 'bottom'} header`,
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

  const sch = kicadSchematic(doc, net, ctx, { name, title, standIns })
  const netlist = sch.netlist
  warnings.push(...sch.warnings)

  // the board: template head, outline, headers with their pads' nets filled in
  const headers = TINYCORE_HAT_HEADERS.map((h) => {
    const ref = refOf.get(h.ref)!
    let text = HAT_HEADERS[h.ref].replace(
      /\(property "Reference" "J[123]"/,
      `(property "Reference" "${ref}"`
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
  const pcb =
    HAT_PCB_HEAD.replace('{{TITLE}}', escapeKicad(title.trim() || 'tinyHAT')).replace(
      '{{DATE}}',
      today(ctx)
    ) +
    HAT_EDGE_CUTS +
    headers.join('') +
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
    `2. Open the board (${name}.kicad_pcb). The HAT outline and the three tinyCore`,
    '   headers are already there, on the right nets.',
    '3. Tools > Update PCB from Schematic... > Update PCB. Every part appears beside',
    '   the board with its ratsnest to the headers. (Or, without the schematic:',
    `   File > Import > Netlist..., choose ${name}.net, Update PCB.)`,
    '4. Place the parts on the HAT (no mounting holes: the HAT clips onto the',
    '   tinyCore by its headers), route, and run DRC.',
    '',
    'Exporting again from tinyStudio rewrites the schematic, netlist and this',
    'README, and leaves the board and project alone, so a layout is never lost:',
    'run Update PCB from Schematic again to pick up the changes.',
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
