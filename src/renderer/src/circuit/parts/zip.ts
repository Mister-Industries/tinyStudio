/**
 * circuit/parts/zip — minimal ZIP reader for `.fzpz` drop-import (M2).
 *
 * No dependency: entries are located via the central directory and inflated
 * with the native `DecompressionStream('deflate-raw')` (Chromium, web, and
 * Node ≥18 — so this stays testable under `node --test`). Only what Fritzing
 * archives need: stored (method 0) and deflated (method 8) entries, no
 * encryption, no ZIP64 (a .fzpz is a handful of SVGs).
 */

const EOCD_SIG = 0x06054b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50

export interface ZipEntry {
  name: string
  data: Uint8Array
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds)
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Read every file entry of a ZIP archive. Throws on a malformed archive. */
export async function unzip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // End-of-central-directory: scan backwards (comment can pad the tail).
  let eocd = -1
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory)')
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)

  const decoder = new TextDecoder()
  const out: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== CEN_SIG) throw new Error('bad central directory entry')
    const method = dv.getUint16(off + 10, true)
    const compSize = dv.getUint32(off + 20, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = decoder.decode(bytes.subarray(off + 46, off + 46 + nameLen))
    off += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // directory entry
    if (dv.getUint32(localOff, true) !== LOC_SIG) throw new Error('bad local header')
    // local header name/extra lengths can differ from the central ones
    const lNameLen = dv.getUint16(localOff + 26, true)
    const lExtraLen = dv.getUint16(localOff + 28, true)
    const start = localOff + 30 + lNameLen + lExtraLen
    const comp = bytes.subarray(start, start + compSize)

    if (method === 0) out.push({ name, data: comp.slice() })
    else if (method === 8) out.push({ name, data: await inflateRaw(comp) })
    else throw new Error(`unsupported compression method ${method} for ${name}`)
  }
  return out
}
