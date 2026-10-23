import { expect, it } from 'vitest'
import { mcpAtOrigin } from '../mcp-configuration'
import type { AgentConnectionState } from '../../shared/agents'

it.each(['http://truenas.local:10708', 'https://notes.example.com'])('copies the MCP endpoint for the current server origin: %s', origin => {
  const original = JSON.stringify({ mcpServers: { hidocknotes: { url: 'https://notes.example.com/api/v1/mcp', headers: { Authorization: 'Bearer <create a token below>' } } } })
  const state: AgentConnectionState = { enabled: true, running: true, error: null, tools: [], setup: { other: original, codex: '', claude: '' } }
  const value = mcpAtOrigin(state, origin)
  expect(JSON.parse(value.setup.other).mcpServers.hidocknotes).toEqual({ url: origin + '/api/v1/mcp', headers: { Authorization: 'Bearer <create a token below>' } })
  expect(state.setup.other).toBe(original)
})
