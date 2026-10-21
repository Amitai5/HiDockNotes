import { useEffect, useState } from 'react'
import { Check, Copy, Plug, ShieldCheck } from 'lucide-react'
import type { AgentConnectionState } from '../shared/agents'
import { Button, Toggle } from './ui'
import { reportError } from '../store/useAppStore'

export function AgentConnectionsPanel(): JSX.Element {
  const [state, setState] = useState<AgentConnectionState | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { let mounted = true; void window.electronAPI.agents.state().then(value => { if (mounted) setState(value) }).catch(reportError); return () => { mounted = false } }, [])
  async function enable(value: boolean): Promise<void> {
    setBusy(true); setCopied(false)
    try { setState(await window.electronAPI.agents.setEnabled(value)) } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <section className="settings-section" id="agent-connections" tabIndex={-1}>
    <h2><Plug size={18} />MCP server</h2>
    <div className="setting-row"><strong>Enable MCP access</strong><Toggle label="Enable MCP access" checked={state?.enabled ?? false} disabled={!state || busy} onChange={value => { void enable(value) }} /></div>
    <div className={`agent-status ${state?.running ? 'agent-status-ready' : ''}`} role="status"><span />{state?.running ? 'Ready for your agent' : state?.error ? 'Connection needs attention' : state ? 'Agent access is off' : 'Loading connection…'}</div>
    {state?.error && <p className="provider-error" role="alert">{state.error}</p>}
    <div className="agent-access-summary"><ShieldCheck size={16} /><strong>Read-only</strong><span>Local · stdio · Keep HiDockNotes open</span></div>
    <p className="agent-privacy">Your agent may share retrieved text with its AI provider.</p>
    <div className="agent-setup"><div className="panel-heading"><h3>MCP configuration</h3><Button disabled={!state?.running || busy} onClick={() => { void window.electronAPI.agents.copySetup('other').then(() => setCopied(true)).catch(reportError) }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy configuration'}</Button></div>
      <p>Add this server in your agent’s MCP settings.</p>
      {state && <pre className="agent-setup-code" aria-label="MCP configuration"><code>{state.setup.other}</code></pre>}
    </div>
    <details className="agent-tools"><summary>Available tools{state ? ` (${state.tools.length})` : ''}</summary>{state?.tools.map(tool => <div key={tool.name}><code>{tool.name}</code><span>{tool.description}</span></div>)}</details>
  </section>
}

