/**
 * settings: persistent app settings for the main process.
 *
 * Stores the Studio AI settings: the Anthropic API key and the model to use.
 * The key is encrypted at rest with Electron's safeStorage (OS keychain / DPAPI)
 * and written to userData. We never expose the key to the renderer; the renderer
 * only ever learns whether a key is configured, never its value.
 */

import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { isAgentModel, resolveAgentModel, type AgentModelId } from '../shared/agentModels'

interface StoredSettings {
  /** base64 of the encrypted (or, if encryption is unavailable, plaintext) key */
  apiKeyEnc?: string
  /** true when apiKeyEnc was produced by safeStorage; false = plaintext fallback */
  apiKeyEncrypted?: boolean
  /** Studio AI model id (shared/agentModels.ts); unset means the default */
  model?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'agent-settings.json')
}

async function read(): Promise<StoredSettings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8')) as StoredSettings
  } catch {
    return {}
  }
}

async function write(s: StoredSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(s, null, 2), 'utf-8')
}

export async function setApiKey(key: string): Promise<void> {
  const s = await read()
  if (safeStorage.isEncryptionAvailable()) {
    s.apiKeyEnc = safeStorage.encryptString(key).toString('base64')
    s.apiKeyEncrypted = true
  } else {
    // Fallback for platforms where the OS keychain isn't available. Still
    // base64 so it isn't sitting in plain sight, but it is NOT real encryption.
    s.apiKeyEnc = Buffer.from(key, 'utf-8').toString('base64')
    s.apiKeyEncrypted = false
  }
  await write(s)
}

export async function clearApiKey(): Promise<void> {
  const s = await read()
  delete s.apiKeyEnc
  delete s.apiKeyEncrypted
  await write(s)
}

/**
 * Resolve the usable API key: the stored one if present, otherwise the
 * ANTHROPIC_API_KEY environment variable (handy for local dev). Returns null
 * when neither is available.
 */
export async function getApiKey(): Promise<string | null> {
  const s = await read()
  if (s.apiKeyEnc) {
    const buf = Buffer.from(s.apiKeyEnc, 'base64')
    try {
      return s.apiKeyEncrypted ? safeStorage.decryptString(buf) : buf.toString('utf-8')
    } catch {
      return null
    }
  }
  return process.env.ANTHROPIC_API_KEY ?? null
}

/** The chosen Studio AI model, or the default when none is stored or it's no longer offered. */
export async function getModel(): Promise<AgentModelId> {
  return resolveAgentModel((await read()).model)
}

export async function setModel(model: string): Promise<void> {
  if (!isAgentModel(model)) throw new Error(`Unknown model: ${model}`)
  const s = await read()
  s.model = model
  await write(s)
}

export type ApiKeySource = 'stored' | 'env' | 'none'

export async function getStatus(): Promise<{ configured: boolean; source: ApiKeySource }> {
  const s = await read()
  if (s.apiKeyEnc) return { configured: true, source: 'stored' }
  if (process.env.ANTHROPIC_API_KEY) return { configured: true, source: 'env' }
  return { configured: false, source: 'none' }
}
