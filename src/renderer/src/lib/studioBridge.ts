/**
 * studioBridge — the renderer side of Studio AI's live-state tools
 * (StudioBridge in shared/agentCore): circuit inspection, parts search, and
 * the serial buffer.
 *
 * The web agent calls it directly. On desktop the agent runs in the main
 * process and forwards these calls over IPC; serveStudioRequests() answers them.
 * The circuit half loads lazily, since it pulls in the parts registry.
 */

import type { StudioBridge, StudioMethod } from '../../../shared/agentCore'

const MAX_SERIAL_LINES = 300

function readSerial(count: number): string {
  const lines = window.__tinySerial?.lines ?? []
  if (lines.length === 0) {
    return 'No serial lines received since the app opened. Is the board plugged in, with its port selected and the sketch uploaded?'
  }
  const n = Math.min(Math.max(1, Math.round(count) || 1), MAX_SERIAL_LINES)
  const shown = lines.slice(-n)
  return `Last ${shown.length} of ${lines.length} buffered lines, oldest first:\n${shown.join('\n')}`
}

export const studioBridge: StudioBridge = {
  inspectCircuit: async (text) => (await import('./agentCircuit.js')).inspectCircuitText(text),
  findParts: async (query) => (await import('./agentCircuit.js')).findParts(query),
  readSerial: async (count) => readSerial(count)
}

function call(method: StudioMethod, arg: string | number): Promise<string> {
  switch (method) {
    case 'inspectCircuit':
      return studioBridge.inspectCircuit(String(arg))
    case 'findParts':
      return studioBridge.findParts(String(arg))
    case 'readSerial':
      return studioBridge.readSerial(Number(arg))
  }
}

/** Desktop: answer the main-process agent's requests. Returns an unsubscribe. */
export function serveStudioRequests(): () => void {
  const api = window.api?.agent
  if (!api?.onStudioRequest || !api.respondStudio) return () => {}
  const respond = api.respondStudio
  return api.onStudioRequest(({ id, method, arg }) => {
    call(method, arg).then(
      (value) => respond(id, { ok: true, value }),
      (e) => respond(id, { ok: false, value: e instanceof Error ? e.message : String(e) })
    )
  })
}
