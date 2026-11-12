/**
 * circuit/export/spice: the netlist the simulator runs, as a standalone .cir
 * file (LTspice, ngspice). Exactly what tinyStudio solved, so a result in a
 * report can be reproduced elsewhere.
 */

import type { CircuitDoc } from '../core/model'
import type { NetModel } from '../core/nets'
import { generateNetlist } from '../core/netlist'
import { defaultAttrsFor } from '../parts/naming'
import { today, type ExportContext } from './common'
import type { ExportResult } from './kicadNetlist'

export function spiceFile(doc: CircuitDoc, net: NetModel, ctx: ExportContext = {}): ExportResult {
  const gen = generateNetlist(doc, net, {
    familyOf: ctx.familyOf,
    defaultAttrsOf: defaultAttrsFor,
    title: 'tinyStudio circuit'
  })
  const [title, ...rest] = gen.netlist.split('\n')
  const notes = [
    `* Exported from tinyStudio, ${today(ctx)}`,
    ...gen.warnings.map((w) => `* warning: ${w}`)
  ]
  return { text: [title, ...notes, ...rest].join('\n'), warnings: gen.warnings }
}
