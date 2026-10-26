/**
 * circuit/parts/packMigration — move parts out of the retired monolithic
 * `tinystudio-core` pack and into the bins they'd get today.
 *
 * tinyparts used to ship one 1776-part pack. Now it ships ~43 (Core sections,
 * SparkFun sub-bins, one per vendor), and the palette draws a tab per pack —
 * which would leave anyone who installed the old pack staring at a single
 * enormous "tinystudio-core" tab forever.
 *
 * `assets/packMigration.json` is generated alongside the split by
 * `scripts/split-parts-packs.mjs`, so the mapping here is by construction the
 * same classification the published packs used. Migration is a local restamp:
 * the part definitions are already in IndexedDB, only their `pack` field is
 * stale. Nothing is re-downloaded.
 *
 * Runs once (guarded by a localStorage flag) on the first mount of the circuit
 * view after upgrading. Safe to call repeatedly.
 */

import migrationJson from '../../assets/packMigration.json'
import {
  PART_MANIFEST,
  packIdOfBin,
  restampPack,
  restoreBundledParts,
  type PackRestamp
} from '../../lib/partsLibrary'
import { deleteUserPart, saveUserParts } from '../../lib/userParts'
import { forgetPack, recordPackMeta } from './packs'

interface MigrationFile {
  schema: number
  /** the tinyparts release this map was generated from */
  version?: string
  /** pack ids whose parts should be re-filed */
  legacyPackIds: string[]
  /** new pack id → the parts that belong to it, with their new presentation */
  packs: Record<string, PackRestamp[]>
  /** pack ids the app now ships itself — a downloaded copy is redundant */
  bundledPackIds?: string[]
}

const LS_DONE = 'tinystudio.packs.migratedTo'
/** Bump when the migration map changes shape enough to warrant a re-run.
 * 1.2.0 added variant merging + label disambiguation, which means parts that
 * already migrated at 1.1.0 need a second pass to pick up the new labels.
 * 1.3.0 folded the ten Core packs into the app, so an install that downloaded
 * them has to throw those copies away. */
const MIGRATION_VERSION = '1.3.0'

const data = migrationJson as MigrationFile

export interface MigrationResult {
  /** parts moved into a new pack bin */
  moved: number
  /** parts that were in a legacy pack but absent from the map */
  unmapped: string[]
  /** new pack ids that gained at least one part */
  packs: string[]
  /** downloaded parts discarded in favour of a bundled copy */
  discarded: number
}

/**
 * Drop parts that came from a pack the app now bundles.
 *
 * The ten Core packs used to be downloads; they ship with tinyStudio now. An
 * install that already fetched them has a persisted copy of every part, and
 * because a persisted part is registered *after* the bundled manifest, that
 * stale copy wins — you'd end up with a "Core · Basic" tab beside the Core bin,
 * showing the pre-fold duplicate tiles. So the downloaded copies are deleted
 * and the shipped manifest rows restored underneath them.
 *
 * Only parts the app actually ships are dropped — `restoreBundledParts` returns
 * exactly those, so a pack that gained parts after being bundled keeps them
 * rather than losing them silently.
 */
async function discardBundled(bundled: Set<string>): Promise<number> {
  if (!bundled.size) return 0
  const fromBundledPack = PART_MANIFEST.filter((m) => {
    const packId = packIdOfBin(m.source)
    return packId && bundled.has(packId)
  }).map((m) => m.type)

  const restored = restoreBundledParts(fromBundledPack)
  for (const type of restored) await deleteUserPart(type)
  for (const id of bundled) forgetPack(id)
  return restored.length
}

function alreadyDone(): boolean {
  try {
    return localStorage.getItem(LS_DONE) === MIGRATION_VERSION
  } catch {
    return false
  }
}

function markDone(): void {
  try {
    localStorage.setItem(LS_DONE, MIGRATION_VERSION)
  } catch {
    /* quota / privacy mode — we'll just re-run the (idempotent) migration */
  }
}

/**
 * Re-file legacy-pack parts. Call after `initUserParts()` so the registry is
 * populated. Resolves with what moved; a no-op run resolves with moved: 0.
 */
export async function migrateLegacyPacks(force = false): Promise<MigrationResult> {
  const empty: MigrationResult = { moved: 0, unmapped: [], packs: [], discarded: 0 }
  if (!force && alreadyDone()) return empty

  // First: hand the Core packs back to the app. This runs before the restamp so
  // a part that was in the old monolithic pack, got re-filed into core-basic,
  // and is now bundled doesn't get restamped into a tab that no longer exists.
  const discarded = await discardBundled(new Set(data.bundledPackIds ?? []))

  const legacy = new Set(data.legacyPackIds ?? [])
  // Parts still sitting in a retired pack. Matching on the manifest (not the
  // migration map) means a part the user has since deleted just isn't here.
  const stale = new Set<string>()
  for (const m of PART_MANIFEST) {
    const packId = packIdOfBin(m.source)
    if (packId && legacy.has(packId)) stale.add(m.type)
  }
  if (!stale.size) {
    markDone()
    return { ...empty, discarded }
  }

  const touched: string[] = []
  const written = new Map<string, ReturnType<typeof restampPack>[number]>()

  for (const [newPackId, entries] of Object.entries(data.packs ?? {})) {
    const mine = entries.filter((e) => stale.has(e.type))
    if (!mine.length) continue
    const defs = restampPack(mine, newPackId)
    for (const e of mine) stale.delete(e.type)
    if (!defs.length) continue
    touched.push(newPackId)
    for (const d of defs) written.set(d.type, d)
    // the pack is now "installed" as far as the UI is concerned — record it so
    // its tab gets a proper name and icon instead of a bare id
    recordPackMeta({ id: newPackId, version: data.version ?? MIGRATION_VERSION })
  }

  // persist the restamped defs in one transaction
  await saveUserParts([...written.values()])
  const moved = written.size

  for (const id of legacy) forgetPack(id)
  markDone()

  return { moved, unmapped: [...stale], packs: touched, discarded }
}
