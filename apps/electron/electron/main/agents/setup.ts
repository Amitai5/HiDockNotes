import type { AgentSetupTarget } from '../../../src/shared/agents'

function shellArgument(value: string, platform: NodeJS.Platform): string {
  return platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'"
}
export function agentSetup(executable: string, dataPath: string, platform: NodeJS.Platform, launcher: string, entry?: string): Record<AgentSetupTarget, string> {
  const args = [launcher, ...(entry ? ['--mcp-app', entry] : []), '--mcp-data-dir', dataPath]
  const command = [executable, ...args].map(value => shellArgument(value, platform)).join(' ')
  return {
    codex: 'codex mcp add hidocknotes --env ELECTRON_RUN_AS_NODE=1 -- ' + command,
    claude: 'claude mcp add --env ELECTRON_RUN_AS_NODE=1 --transport stdio --scope user hidocknotes -- ' + command,
    other: JSON.stringify({ mcpServers: { hidocknotes: { command: executable, args, env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2)
  }
}
