import type { AgentConnectionState, AgentSetupTarget } from '../../../src/shared/agents'
import type { AgentConnectionStore } from './connection-store'
import { AgentGateway } from './gateway'
import { AGENT_TOOL_CATALOG } from './tool-catalog'

interface AgentAccessOptions {
  readEnabled(): boolean
  saveEnabled(value: boolean): void
  store: AgentConnectionStore
  call(name: string, argumentsValue: unknown, signal: AbortSignal): unknown
  setup: Record<AgentSetupTarget, string>
}
export class AgentAccessController {
  private enabled: boolean
  private running = false
  private error: string | null = null
  private readonly gateway: AgentGateway
  private pending: Promise<unknown> = Promise.resolve()
  constructor(private readonly options: AgentAccessOptions) { this.enabled = options.readEnabled(); this.gateway = new AgentGateway(options.call) }
  state(): AgentConnectionState { return { enabled: this.enabled, running: this.running, error: this.error, tools: AGENT_TOOL_CATALOG.map(({ name, description }) => ({ name, description })), setup: this.options.setup } }
  start(): Promise<AgentConnectionState> { return this.setEnabled(this.enabled) }
  setEnabled(value: boolean): Promise<AgentConnectionState> {
    const operation = this.pending.then(async () => {
      this.enabled = value
      this.error = null
      this.options.saveEnabled(value)
      try {
        if (!value) { await this.gateway.close(); this.running = false; await this.options.store.remove() }
        else if (!this.running) { const connection = await this.gateway.start(); await this.options.store.save(connection); this.running = true }
      } catch {
        await this.gateway.close()
        this.running = false
        this.error = 'Agent access could not start securely. Check your operating-system key storage, then turn access off and on.'
      }
      return this.state()
    })
    this.pending = operation.catch(() => undefined)
    return operation
  }
  async close(): Promise<void> { await this.pending; await this.gateway.close(); this.running = false; await this.options.store.remove() }
}
