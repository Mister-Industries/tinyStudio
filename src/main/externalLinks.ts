import { shell } from 'electron'

const SAFE_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

/** True for web and mail links: the only things tinyStudio hands to the OS to open. */
export function isSafeExternalUrl(url: unknown): boolean {
  try {
    return SAFE_PROTOCOLS.has(new URL(String(url)).protocol)
  } catch {
    return false
  }
}

/** Open a web or mail link in the user's default app; anything else is ignored. */
export async function openExternalSafely(url: unknown): Promise<void> {
  if (!isSafeExternalUrl(url)) return
  await shell.openExternal(new URL(String(url)).toString())
}
