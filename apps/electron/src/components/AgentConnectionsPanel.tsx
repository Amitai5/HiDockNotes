import { useEffect, useState } from 'react'
import { Check, Copy, Plug, ShieldCheck } from 'lucide-react'
import type { AgentConnectionState, AgentSetupTarget } from '../shared/agents'
import { Button, Toggle } from './ui'
import { reportError } from '../store/useAppStore'

const clients: { id: AgentSetupTarget; label: string }[] = [{ id: 'codex', label: 'Codex' }, { id: 'claude', label: 'Claude Code' }, { id: 'other', label: 'Other MCP clients' }]
export function AgentConnectionsPanel(): JSX.Element {
  const [state, setState] = useState<AgentConnectionState | null>(null)
  const [target, setTarget] = useState<AgentSetupTarget>('codex')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => { let mounted = true; void window.electronAPI.agents.state().then(value => { if (mounted) setState(value) }).catch(reportError); return () => { mounted = false } }, [])
  async function enable(value: boolean): Promise<void> {
    setBusy(true); setCopied(false)
    try { setState(await window.electronAPI.agents.setEnabled(value)) } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <section className="settings-section" id="agent-connections" tabIndex={-1}>
    <h2><Plug size={18} />Connect your AI agent</h2><p>Give Codex, Claude Code, or another MCP client access to your notes through a local connection.</p>
    <div className="setting-row"><div><strong>Enable MCP access</strong><p>Available while HiDockNotes is running. Turn this off to revoke access immediately.</p></div><Toggle label="Enable MCP access" checked={state?.enabled ?? false} disabled={!state || busy} onChange={value => { void enable(value) }} /></div>
    <div className={`agent-status ${state?.running ? 'agent-status-ready' : ''}`} role="status"><span />{state?.running ? 'Ready for your agent' : state?.error ? 'Connection needs attention' : state ? 'Agent access is off' : 'Loading connection…'}</div>
    {state?.error && <p className="provider-error" role="alert">{state.error}</p>}
    <div className="agent-permissions"><ShieldCheck size={20} /><div><strong>Read-only access</strong><p>Your agent can search and read notes, transcripts, projects, and action items. Audio, voice embeddings, credentials, and recorder controls are not exposed.</p></div></div>
    <p className="agent-privacy">An agent may send the text it reads to its own AI provider. This connection makes no cloud AI calls itself.</p>
    <div className="agent-setup"><h3>Set up your client</h3><div className="agent-client-options" role="group" aria-label="Agent client">{clients.map(client => <button key={client.id} type="button" aria-pressed={target === client.id} onClick={() => { setTarget(client.id); setCopied(false) }}>{client.label}</button>)}</div>
      <p>{target === 'other' ? 'Add this entry to your client’s MCP configuration.' : `Run this command in your terminal to register HiDockNotes, then restart ${target === 'codex' ? 'Codex' : 'Claude Code'}.`}</p>
      {state && <><pre className="agent-setup-code" aria-label="Agent setup configuration"><code>{state.setup[target]}</code></pre><Button disabled={!state.running || busy} onClick={() => { void window.electronAPI.agents.copySetup(target).then(() => setCopied(true)).catch(reportError) }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : target === 'other' ? 'Copy configuration' : 'Copy command'}</Button></>}
      <small>Enable access before connecting. No API key or separate Node installation is needed. If you move the app, copy the updated setup command.</small>
    </div>
    <div className="agent-tools"><h3>Available tools</h3>{state?.tools.map(tool => <div key={tool.name}><code>{tool.name}</code><span>{tool.description}</span></div>)}</div>
  </section>
}

