/**
 * circuit/parts/partsBoot: bring every parts layer up, in order, once per run.
 *
 *   bundled  registered as soon as lib/partsLibrary loads (always there)
 *   remote   packs cached from GitHub on an earlier run      (parts/packs.ts)
 *   user     this computer's saved parts and local edits    (lib/userParts.ts)
 *   dev      a local tinyparts checkout, dev servers only    (parts/devFolder.ts)
 *
 * …then, in the background, ask GitHub whether tinyparts changed since the
 * last check (parts/tinypartsSync.ts). The editor is usable before that answer.
 */

import { adoptLegacyCopies, initUserParts } from '../../lib/userParts'
import { startDevParts } from './devFolder'
import { initRemoteLayer } from './packs'
import { syncTinyparts } from './tinypartsSync'

let boot: Promise<void> | null = null

export function initPartsLibrary(): Promise<void> {
  if (!boot) {
    boot = (async () => {
      await initRemoteLayer().catch((e) =>
        console.warn('[parts] reading the parts cache failed', e)
      )
      await initUserParts().catch((e) => console.warn('[parts] reading saved parts failed', e))
      await startDevParts().catch((e) => console.warn('[parts] live tinyparts failed', e))
      void syncTinyparts().then(() => adoptLegacyCopies())
    })()
  }
  return boot
}
