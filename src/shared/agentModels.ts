/**
 * agentModels: the Claude models Studio AI can use, and the request options
 * each one accepts. Shared by the desktop main process, the web agent and the
 * settings UI so the list is defined once.
 */

export const AGENT_MODELS = [
  { id: 'claude-opus-5', label: 'Opus 5', note: 'most capable, the default' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', note: 'faster and cheaper' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', note: 'fastest' }
] as const

export type AgentModelId = (typeof AGENT_MODELS)[number]['id']

export const DEFAULT_AGENT_MODEL: AgentModelId = 'claude-opus-5'

export function isAgentModel(id: unknown): id is AgentModelId {
  return AGENT_MODELS.some((m) => m.id === id)
}

/** A stored choice that is missing or no longer offered falls back to the default. */
export function resolveAgentModel(stored: unknown): AgentModelId {
  return isAgentModel(stored) ? stored : DEFAULT_AGENT_MODEL
}

/**
 * Thinking and effort options that are valid for the model. Opus 5 and
 * Sonnet 5 take adaptive thinking and an effort level. Haiku 4.5 predates
 * both: it needs a fixed thinking budget (below max_tokens, at least 1024) and
 * rejects `output_config.effort`.
 */
export function thinkingOptionsFor(
  model: AgentModelId,
  maxTokens: number
): {
  thinking: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number }
  output_config?: { effort: 'high' }
} {
  if (model === 'claude-haiku-4-5-20251001') {
    return { thinking: { type: 'enabled', budget_tokens: Math.min(8000, maxTokens - 1000) } }
  }
  return { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }
}
