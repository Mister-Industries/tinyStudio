/**
 * Shared shapes for the Studio AI agent's IPC messages. These mirror the types
 * the main process (AgentService) emits and the preload bridge forwards.
 */

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'done'; stopReason: string }
  | { type: 'error'; message: string }

export interface AgentPermissionRequest {
  id: string
  tool: string
  action: string
  path: string
  preview: string
}
