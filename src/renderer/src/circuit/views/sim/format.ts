/** Engineering notation for plot readouts: 4.70k, 12.00m, 3.30µ. */
export function fmtEng(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}k`
  if (a >= 1) return v.toFixed(2)
  if (a >= 1e-3) return `${(v * 1e3).toFixed(2)}m`
  if (a >= 1e-6) return `${(v * 1e6).toFixed(2)}µ`
  if (a === 0) return '0'
  return `${(v * 1e9).toFixed(2)}n`
}

/** A value with an SI prefix and unit, for tables: "4.70 kΩ", "3.300 V". */
export function fmtSI(v: number, unit: string): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} M${unit}`
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)} k${unit}`
  if (a >= 1) return `${v.toFixed(3)} ${unit}`
  if (a >= 1e-3) return `${(v * 1e3).toFixed(2)} m${unit}`
  if (a >= 1e-6) return `${(v * 1e6).toFixed(2)} µ${unit}`
  if (a === 0) return `0 ${unit}`
  return `${(v * 1e9).toFixed(2)} n${unit}`
}
