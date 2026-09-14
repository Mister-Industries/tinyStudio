/** What the circuit canvas has selected. */
export interface Selection {
  parts: Set<string>
  wires: Set<string>
  /** selected net-label ids (schematic) */
  labels?: Set<string>
}

export const emptySel = (): Selection => ({
  parts: new Set(),
  wires: new Set(),
  labels: new Set()
})
