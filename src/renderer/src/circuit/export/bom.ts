/**
 * circuit/export/bom: bill of materials as CSV, one row per distinct part
 * (same type, value and footprint), with JLCPCB-friendly column names.
 */

import type { CircuitDoc } from '../core/model'
import { compareRefs, exportValue, type ExportContext } from './common'
import type { ExportResult } from './kicadNetlist'
import { isExportedPart, kicadMappingFor } from './kicadMap'

export interface BomRow {
  refs: string[]
  value: string
  part: string
  footprint: string
}

const HEADER = ['Designator', 'Quantity', 'Value', 'Part', 'Footprint', 'LCSC', 'SparkFun PROD_ID']

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function bomRows(doc: CircuitDoc, ctx: ExportContext = {}): BomRow[] {
  const groups = new Map<string, BomRow>()
  for (const part of doc.parts) {
    if (!isExportedPart(part.type)) continue
    const value = exportValue(part, ctx)
    const footprint = kicadMappingFor(part.type, ctx.pinsOf?.(part.type) ?? []).footprint
    const key = `${part.type}\u0000${value}\u0000${footprint}`
    let row = groups.get(key)
    if (!row) {
      row = { refs: [], value, part: ctx.labelOf?.(part.type) ?? part.type, footprint }
      groups.set(key, row)
    }
    row.refs.push(part.id)
  }
  const rows = [...groups.values()]
  for (const r of rows) r.refs.sort(compareRefs)
  return rows.sort((a, b) => compareRefs(a.refs[0], b.refs[0]))
}

export function bomCsv(doc: CircuitDoc, ctx: ExportContext = {}): ExportResult {
  const rows = bomRows(doc, ctx)
  const lines = [
    HEADER,
    ...rows.map((r) => [r.refs.join(', '), r.refs.length, r.value, r.part, r.footprint, '', ''])
  ]
  const warnings = rows.filter((r) => !r.footprint).map((r) => `${r.refs.join(', ')}: no footprint`)
  return { text: lines.map((l) => l.map(csvCell).join(',')).join('\n') + '\n', warnings }
}
