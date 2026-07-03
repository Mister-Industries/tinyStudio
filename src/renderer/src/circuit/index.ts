/**
 * circuit/ — public API of the Circuit View v2 module.
 *
 * Everything outside this folder should import from here (or from
 * `circuit/views/CircuitView` for the React mount) — internals may reshuffle.
 *
 * Feature flag (M0–M3): localStorage `tinystudio.circuitV2` = '1' switches the
 * Circuit tab from the legacy DiagramEditor to the v2 module. Flip it from
 * DevTools:  localStorage.setItem('tinystudio.circuitV2', '1')
 */

export * from './core/model'
export * as routing from './core/routing'
export { buildNets, describeNet, danglingJunctions, endKey, wireKey } from './core/nets'
export type { NetModel, BuildNetsOptions } from './core/nets'
export * as commands from './core/commands'
export { CircuitStore } from './core/store'
export * from './core/geometry'
export * from './core/refdes'
export * from './core/clipboard'
export { namespaceSvgIds, svgNs, stripSvgSize, escapeXml } from './parts/svg'

export const CIRCUIT_V2_FLAG = 'tinystudio.circuitV2'

export function circuitV2Enabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(CIRCUIT_V2_FLAG) === '1'
  } catch {
    return false
  }
}
