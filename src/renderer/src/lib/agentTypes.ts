/**
 * Shared shapes for the Studio AI agent's events. Defined once in the agent core,
 * which both the desktop main process (AgentService) and the web build (webAgent)
 * run.
 */

export type { AgentEvent, AgentPermissionRequest } from '../../../shared/agentCore'
