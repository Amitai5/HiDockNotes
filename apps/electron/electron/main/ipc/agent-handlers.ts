import { clipboard } from 'electron'
import type { AgentAccessController } from '../agents/controller'
import { handle } from './trusted-ipc'
import { validateBoolean } from './jensen-validation'
import type { AgentSetupTarget } from '../../../src/shared/agents'

export function registerAgentHandlers(controller: AgentAccessController): void {
  handle('agents:state', () => controller.state())
  handle('agents:enabled', value => controller.setEnabled(validateBoolean(value)))
  handle('agents:copy-setup', value => {
    if (value !== 'codex' && value !== 'claude' && value !== 'other') throw new Error('Choose a supported MCP client.')
    clipboard.writeText(controller.state().setup[value as AgentSetupTarget])
  })
}
