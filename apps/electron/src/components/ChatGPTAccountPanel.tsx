import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, ExternalLink, LogOut, Plus, RefreshCw } from 'lucide-react'
import type { AIState } from '../shared/ai'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export function ChatGPTAccountPanel({ state, accept }: { state: AIState; accept(value: AIState): void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const account = state.chatgpt
  const selected = account?.profiles.find(profile => profile.id === account.activeProfileId)
  async function perform(action: () => Promise<AIState>): Promise<void> {
    setBusy(true); setMessage('')
    try { accept(await action()) }
    catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'ChatGPT sign-in could not complete. Try again.') }
    finally { setBusy(false) }
  }
  return <div className="provider-card chatgpt-card">
    <div className="provider-heading"><h3>Use your ChatGPT plan</h3>{account?.planEnabled && <span className="status status-verified"><CheckCircle2 size={12} />Connected</span>}</div>
    <p>Sign in with the ChatGPT account you use for Codex. Eligible summaries, action items and Assistant answers use your plan allowance or available credits.</p>
    <small>Audio transcription uses Local Whisper on this computer by default. Gemini and OpenAI API transcription are optional. ChatGPT plan usage does not support audio transcription.</small>
    {!!account?.profiles.length && <label className="chatgpt-account-picker">ChatGPT account<select aria-label="ChatGPT account" value={account.activeProfileId ?? ''} disabled={busy || account.signingIn} onChange={event => { void perform(() => window.electronAPI.ai.chatgpt.select(event.target.value)) }}>{account.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · {profile.email ?? profile.name ?? 'ChatGPT account'}{!profile.connected ? ' · signed out' : ''}</option>)}</select></label>}
    {selected && <p className="chatgpt-account-status">{selected.connected ? selected.planEnabled ? 'ChatGPT plan usage is enabled.' : 'Signed in. Plan usage permission is not enabled; reconnect to authorize it.' : 'This connection is signed out. Continue with ChatGPT to reconnect.'}</p>}
    <div className="provider-tools chatgpt-actions">
      {account?.usageBlocked && <Button disabled={busy} onClick={() => { void perform(() => window.electronAPI.ai.chatgpt.resume()) }}>Retry plan requests</Button>}
      {account?.signingIn ? <><span role="status">Complete sign-in in your browser…</span><Button disabled={busy} onClick={() => { void perform(() => window.electronAPI.ai.chatgpt.cancelSignIn()) }}>Cancel sign-in</Button></> : <>
        {(!selected?.connected || !selected.planEnabled) && <Button className="chatgpt-sign-in" disabled={busy} onClick={() => { void perform(() => window.electronAPI.ai.chatgpt.signIn(selected?.id ?? null)) }}>Continue with ChatGPT</Button>}
        {!!account?.profiles.length && <Button disabled={busy} onClick={() => { void perform(() => window.electronAPI.ai.chatgpt.signIn(null)) }}><Plus size={14} />Add account</Button>}
        {selected?.planEnabled && <Button variant="ghost" disabled={busy} onClick={() => { void perform(() => window.electronAPI.ai.chatgpt.refreshModels()) }}><RefreshCw size={13} />Refresh models</Button>}
        {selected?.connected && <Button variant="ghost" disabled={busy} onClick={() => { void perform(async () => { const result = await window.electronAPI.ai.chatgpt.signOut(selected.id); if (result.message) setMessage(result.message); return result.state }) }}><LogOut size={14} />Sign out</Button>}
      </>}
      <Button variant="ghost" onClick={() => { void window.electronAPI.ai.chatgpt.manageUsage().catch(reportError) }}><ExternalLink size={13} />Manage usage</Button>
    </div>
    {(message || account?.error) && <p className="provider-error" role="alert">{message || account?.error}</p>}
    <Dialog.Root open={account?.welcomePending ?? false} onOpenChange={open => { if (!open) void perform(() => window.electronAPI.ai.chatgpt.acknowledgeWelcome()) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog">
      <Dialog.Title>You’re using your ChatGPT plan</Dialog.Title><Dialog.Description>HiDockNotes summaries, action items and Assistant answers can now use your ChatGPT plan allowance or credits. Manage this app’s access and limits in ChatGPT settings. Audio transcription uses the separate provider selected in HiDockNotes.</Dialog.Description>
      <div className="dialog-actions"><Button onClick={() => { void window.electronAPI.ai.chatgpt.manageUsage().catch(reportError) }}>Manage usage</Button><Button variant="primary" disabled={busy} onClick={() => { void perform(() => window.electronAPI.ai.chatgpt.acknowledgeWelcome()) }}>Got it</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
