/**
 * circuit/parts/bundled: the tinyparts packs compiled into the app, so a fresh
 * install works offline with the tinyBoards and Core parts already there.
 *
 * The files under assets/tinyparts/ are a COPY of the tinyparts repo, made by
 * `npm run parts:sync`; snapshot.gen.ts is the generated index of them. Don't
 * edit either by hand; edit tinyparts and re-sync (docs/parts-and-art.md).
 *
 * part.json files and palette icons are imported eagerly (the palette needs
 * them at startup); view art is a lazy import per file, loaded on first use.
 */

import { EAGER, LAZY, SNAPSHOT } from '../../assets/tinyparts/snapshot.gen'
import type { PartProvider } from '../../lib/partsLibrary'
import {
  buildFolderPart,
  folderPartMeta,
  iconFileOf,
  isPartDef,
  joinPath,
  legacyMeta,
  parsePackJson,
  parsePartJson,
  placeInPack,
  type PackJson,
  type ReadText
} from './folderPart'

export { SNAPSHOT }

export interface BundledPack {
  id: string
  name: string
  version: string
  /** pack-relative path → git blob sha, as of the snapshot's commit */
  files: Record<string, string>
  /** its pack.json, when that parsed */
  json?: PackJson
  providers: PartProvider[]
  errors: string[]
}

/** Read a repo-relative path out of the snapshot. */
export const readBundled: ReadText = async (path) => {
  const p = joinPath(path)
  if (EAGER[p] !== undefined) return EAGER[p]
  const lazy = LAZY[p]
  if (!lazy) throw new Error(`${p} is not in the bundled tinyparts snapshot`)
  return lazy()
}

/** Name/version/part count of each bundled pack, without building any parts. */
export function bundledPackInfo(): { id: string; name: string; version: string; parts: number }[] {
  return SNAPSHOT.packs.map((sp) => {
    try {
      const pack = parsePackJson(EAGER[`packs/${sp.id}/pack.json`] ?? '', sp.id)
      return { id: sp.id, name: pack.name, version: pack.version, parts: pack.parts.length }
    } catch {
      return { id: sp.id, name: sp.id, version: '', parts: 0 }
    }
  })
}

export function bundledPacks(): BundledPack[] {
  return SNAPSHOT.packs.map((sp) => {
    const packDir = `packs/${sp.id}`
    const errors: string[] = []
    const providers: PartProvider[] = []
    let name = sp.id
    let version = ''
    let packJson: PackJson | undefined
    try {
      const pack = parsePackJson(EAGER[`${packDir}/pack.json`] ?? '', `${packDir}/pack.json`)
      packJson = pack
      name = pack.name
      version = pack.version
      for (const [position, ref] of pack.parts.entries()) {
        try {
          if (ref.dir) {
            const dir = joinPath(packDir, ref.dir)
            const json = parsePartJson(EAGER[`${dir}/part.json`] ?? '', `${dir}/part.json`)
            const iconFile = iconFileOf(json)
            providers.push({
              meta: placeInPack(
                folderPartMeta(json, iconFile ? EAGER[joinPath(dir, iconFile)] : undefined),
                ref,
                position
              ),
              load: () =>
                buildFolderPart(json, readBundled, { layer: 'bundled', pack: pack.id, dir })
            })
          } else if (ref.file) {
            const where = joinPath(packDir, ref.file)
            const json: unknown = JSON.parse(EAGER[where] ?? '')
            if (!isPartDef(json)) throw new Error(`${where} is not a valid part definition`)
            const def = {
              ...json,
              source: { layer: 'bundled' as const, pack: pack.id, file: where }
            }
            providers.push({
              meta: placeInPack(legacyMeta(def), ref, position),
              load: async () => def,
              def
            })
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e))
        }
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
    return { id: sp.id, name, version, files: sp.files, json: packJson, providers, errors }
  })
}
