export type AgentSetupTarget = 'codex' | 'claude' | 'other'
export interface AgentConnectionState {
  enabled: boolean
  running: boolean
  error: string | null
  tools: { name: string; description: string }[]
  setup: Record<AgentSetupTarget, string>
}
