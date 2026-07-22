/**
 * circuit/ — public API of the Circuit View module.
 *
 * Everything outside this folder should import from here (or from
 * `circuit/views/CircuitView` for the React mount) — internals may reshuffle.
 *
 * As of M4 this is the only circuit editor (the legacy DiagramEditor and its
 * `tinystudio.circuitV2` feature flag were removed once v2 reached parity +
 * simulation).
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
