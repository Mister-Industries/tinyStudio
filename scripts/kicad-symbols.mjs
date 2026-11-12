#!/usr/bin/env node
/**
 * kicad-symbols.mjs: copy the KiCad stock symbols tinyStudio's schematic export
 * uses into src/renderer/src/circuit/export/kicadSymbols.gen.ts.
 *
 *   node scripts/kicad-symbols.mjs --kicad "/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols"
 *
 * A .kicad_sch carries a copy of every symbol it places (lib_symbols), so the
 * exported schematic opens with KiCad's real R, LED, SW_Push… without the user
 * having any library installed. This script reads those symbols out of a KiCad
 * install, renames each to its lib_id ("Device:R"), flattens derived symbols
 * (`extends`), and writes them as one generated table. Re-run it after a KiCad
 * major release or when export/kicadMap.ts starts using a new symbol.
 *
 * The symbols are from the KiCad libraries (CC-BY-SA 4.0 with the KiCad
 * libraries exception: designs and generated files that use them aren't bound
 * by the share-alike terms). See THIRD_PARTY_NOTICES.md.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Every symbol export/kicadMap.ts and export/kicadSch.ts reference. */
export const SYMBOLS = [
  'Connector_Generic:Conn_01x03',
  'Connector_Generic:Conn_01x08',
  'Connector_Generic:Conn_01x09',
  'Device:Battery_Cell',
  'Device:Buzzer',
  'Device:C',
  'Device:C_Polarized',
  'Device:D',
  'Device:D_Zener',
  'Device:Fuse',
  'Device:L',
  'Device:LED',
  'Device:R',
  'Device:R_Photo',
  'Device:R_Potentiometer',
  'Device:Thermistor',
  'Interface_Optical:TSOP382xx',
  'Regulator_Linear:L7805',
  'Switch:SW_Push',
  'Switch:SW_SPST',
  'Transistor_BJT:Q_NPN_EBC',
  'Transistor_BJT:Q_PNP_EBC',
  'Transistor_FET:Q_NMOS_GDS',
  'power:GND',
  'power:PWR_FLAG'
]

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(
  __dirname,
  '..',
  'src',
  'renderer',
  'src',
  'circuit',
  'export',
  'kicadSymbols.gen.ts'
)

/** The balanced s-expression starting at `start` (an open paren), strings respected. */
function blockAt(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '"') {
      for (i++; i < src.length && src[i] !== '"'; i++) if (src[i] === '\\') i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error('unbalanced s-expression')
}

/** Top-level `(symbol "<name>" …)` blocks of a .kicad_sym, by name. */
function librarySymbols(text) {
  const out = new Map()
  const re = /\n\t\(symbol "((?:[^"\\]|\\.)*)"\n/g
  let m
  while ((m = re.exec(text))) {
    const block = blockAt(text, m.index + 2)
    out.set(m[1], block)
    re.lastIndex = m.index + 2 + block.length
  }
  return out
}

/** Child blocks of a symbol at one indent level deeper, e.g. its properties. */
function childBlocks(block, head) {
  const out = []
  const re = new RegExp(`\\n\\t\\t\\(${head}\\b`, 'g')
  let m
  while ((m = re.exec(block))) out.push(blockAt(block, m.index + 3))
  return out
}

/** A symbol with `(extends "Parent")` rebuilt as a standalone one (lib_symbols can't extend). */
function flatten(name, lib) {
  const own = lib.get(name)
  if (!own) throw new Error(`symbol ${name} not found`)
  const ext = /\(extends "((?:[^"\\]|\\.)*)"\)/.exec(own.slice(0, 400))
  if (!ext) return own
  const parent = flatten(ext[1], lib)
  const props = childBlocks(own, 'property')
  // parent's body with the child's properties, and its units renamed to the child's
  let body = parent
  for (const p of childBlocks(parent, 'property')) body = body.replace(`\n\t\t${p}`, '')
  body = body.replace(/^\(symbol "(?:[^"\\]|\\.)*"/, `(symbol "${name}"`)
  body = body.split(`(symbol "${ext[1]}_`).join(`(symbol "${name}_`)
  const anchor = body.search(/\n\t\t\(symbol "/)
  return body.slice(0, anchor) + props.map((p) => `\n\t\t${p}`).join('') + body.slice(anchor)
}

function main() {
  const argv = process.argv.slice(2)
  const i = argv.indexOf('--kicad')
  if (i < 0 || !argv[i + 1]) {
    console.error('usage: node scripts/kicad-symbols.mjs --kicad <KiCad symbols folder>')
    process.exit(1)
  }
  const dir = argv[i + 1]
  const libs = new Map()
  let version = ''
  const entries = []
  for (const id of SYMBOLS) {
    const [libName, sym] = id.split(':')
    if (!libs.has(libName)) {
      const text = readFileSync(join(dir, `${libName}.kicad_sym`), 'utf8')
      version ||= /\(generator_version "([^"]+)"\)/.exec(text)?.[1] ?? ''
      libs.set(libName, librarySymbols(text))
    }
    const flat = flatten(sym, libs.get(libName))
    // lib_symbols name the top level by lib_id; units keep their bare names
    const named = flat.replace(/^\(symbol "(?:[^"\\]|\\.)*"/, `(symbol ${JSON.stringify(id)}`)
    // one tab less: they sit one level deeper in a schematic, which re-indents anyway
    entries.push([id, named.replace(/\n\t/g, '\n')])
  }
  const body = entries.map(([id, s]) => `  ${JSON.stringify(id)}: ${JSON.stringify(s)}`).join(',\n')
  writeFileSync(
    OUT,
    `// Generated by scripts/kicad-symbols.mjs from KiCad ${version}'s stock symbol\n` +
      `// libraries (CC-BY-SA 4.0 with the KiCad libraries exception; see\n` +
      `// THIRD_PARTY_NOTICES.md). Do not edit: re-run the script.\n\n` +
      `/** lib_id → the symbol's definition, named by lib_id, ready for a .kicad_sch's lib_symbols. */\n` +
      `export const KICAD_LIB_SYMBOLS: Record<string, string> = {\n${body}\n}\n`
  )
  console.log(`wrote ${entries.length} symbols from KiCad ${version} to ${OUT}`)
}

main()
