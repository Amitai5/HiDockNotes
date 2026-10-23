import type { AgentConnectionState } from '../shared/agents'

/** Agent connections use the same server address the owner is currently viewing. */
export function mcpAtOrigin(state: AgentConnectionState, origin: string): AgentConnectionState {
  const configuration = JSON.parse(state.setup.other)
  configuration.mcpServers.hidocknotes.url = origin + '/api/v1/mcp'
  return { ...state, setup: { ...state.setup, other: JSON.stringify(configuration, null, 2) } }
}
