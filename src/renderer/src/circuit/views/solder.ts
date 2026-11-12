/**
 * circuit/views/solder: where a tinyProto gets solder. Every hole a part's
 * lead is seated in, a stacked board's header pin comes through, or a
 * breadboard-view wire ends in, is a joint. Breadboards are plug-in and get
 * none.
 */

import type { CircuitDoc, Pt } from '../core/model'
import { splitPinRef } from '../core/model'
import { isTinyHeaderBoard } from '../parts/boardSymbols'
import { pinWorldOf, type Seat } from './partsAdapter'

/** boards whose holes are soldered rather than plugged into */
export const isSolderBoard = (type: string): boolean => type === 'tinyproto'

/**
 * What pokes up out of the joint: a component's round lead, a header's square
 * post (a tinyProto stacked on a tinyCore), or a wire's bare copper end.
 */
export type JointKind = 'lead' | 'header' | 'wire'

export interface SolderJoint {
  /** the hole's pin ref, e.g. "P1:H.5" */
  key: string
  pos: Pt
  kind: JointKind
}

/** Where a joint goes: each soldered hole once. */
export function solderJoints(doc: CircuitDoc, seats: Seat[]): SolderJoint[] {
  const boards = new Map(
    doc.parts.filter((p) => p.bb && isSolderBoard(p.type)).map((p) => [p.id, p])
  )
  if (!boards.size) return []
  const typeOf = new Map(doc.parts.map((p) => [p.id, p.type]))
  const joints = new Map<string, SolderJoint>()
  for (const s of seats) {
    if (!boards.has(splitPinRef(s.hole).part)) continue
    const from = typeOf.get(splitPinRef(s.pin).part) ?? ''
    // a board under the tinyProto comes through it on its header
    const kind: JointKind = isTinyHeaderBoard(from) && !isSolderBoard(from) ? 'header' : 'lead'
    // a lead and a header pin in one hole: the header post is what shows
    if (joints.get(s.hole)?.kind === 'header') continue
    joints.set(s.hole, { key: s.hole, pos: s.pos, kind })
  }
  for (const w of doc.wires) {
    if (w.view !== 'bb') continue
    for (const end of [w.from, w.to]) {
      if (typeof end !== 'string' || joints.has(end)) continue
      const { part, pin } = splitPinRef(end)
      const board = boards.get(part)
      const pos = board && pinWorldOf(board, pin)
      if (pos) joints.set(end, { key: end, pos, kind: 'wire' })
    }
  }
  return [...joints.values()]
}
