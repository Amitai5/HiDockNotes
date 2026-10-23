import { appClient } from '../services/app-client'
import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { CheckCircle2, ExternalLink, LogOut, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { AIState, ChatGPTProfileView } from '../shared/ai'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export function ChatGPTAccountPanel({ state, accept }: { state: AIState; accept(value: AIState): void }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [removing, setRemoving] = useState<ChatGPTProfileView | null>(null)
  const [removeError, setRemoveError] = useState('')
  const [callbackUrl, setCallbackUrl] = useState('')
  const account = state.chatgpt
  const selected = account?.profiles.find(profile => profile.id === account.activeProfileId)
  useEffect(() => { if (!account?.signingIn) setCallbackUrl('') }, [account?.signingIn])
  async function perform(action: () => Promise<AIState>): Promise<void> {
    setBusy(true); setMessage('')
    try { accept(await action()) }
    catch (error) { setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'ChatGPT sign-in could not complete. Try again.') }
    finally { setBusy(false) }
  }
  async function removeAccount(): Promise<void> {
    if (!removing) return
    setBusy(true); setRemoveError(''); setMessage('')
    try {
      const result = await appClient.ai.chatgpt.remove(removing.id, true)
      accept(result.state); setRemoving(null)
      if (result.message) setMessage(result.message)
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The saved account could not be removed. Try again.')
    } finally { setBusy(false) }
  }
  return <div className="provider-card chatgpt-card">
    <div className="provider-heading"><h3>Use your ChatGPT plan</h3>{account?.planEnabled && <span className="status status-verified"><CheckCircle2 size={12} />Connected</span>}</div>
    <p>Sign in, then paste the returned URL here to connect your plan.</p>

    {!!account?.profiles.length && <label className="chatgpt-account-picker">ChatGPT account<select aria-label="ChatGPT account" value={account.activeProfileId ?? ''} disabled={busy || account.signingIn} onChange={event => { void perform(() => appClient.ai.chatgpt.select(event.target.value)) }}>{account.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label} · {profile.email ?? profile.name ?? 'ChatGPT account'}{!profile.connected ? ' · signed out' : ''}</option>)}</select></label>}
    {selected && !selected.planEnabled && <p className="chatgpt-account-status">{selected.connected ? 'Reconnect to enable plan access.' : 'Signed out.'}</p>}
    <div className="provider-tools chatgpt-actions">
      {account?.usageBlocked && <Button disabled={busy} onClick={() => { void perform(() => appClient.ai.chatgpt.resume()) }}>Retry plan requests</Button>}
      {account?.signingIn ? <><span role="status">Complete sign-in in your browser…</span><Button disabled={busy} onClick={() => { void perform(() => appClient.ai.chatgpt.cancelSignIn()) }}>Cancel sign-in</Button></> : <>
        {(!selected?.connected || !selected.planEnabled) && <Button className="chatgpt-sign-in" disabled={busy} onClick={() => { void perform(() => appClient.ai.chatgpt.signIn(selected?.id ?? null)) }}>Continue with ChatGPT</Button>}
        {!!account?.profiles.length && <Button disabled={busy} onClick={() => { void perform(() => appClient.ai.chatgpt.signIn(null)) }}><Plus size={14} />Add account</Button>}
        {selected?.planEnabled && <Button variant="ghost" disabled={busy} onClick={() => { void perform(() => appClient.ai.chatgpt.refreshModels()) }}><RefreshCw size={13} />Refresh models</Button>}
        {selected?.connected && <Button variant="ghost" disabled={busy} onClick={() => { void perform(async () => { const result = await appClient.ai.chatgpt.signOut(selected.id); if (result.message) setMessage(result.message); return result.state }) }}><LogOut size={14} />Sign out</Button>}
        {selected && <Button variant="ghost" disabled={busy} onClick={() => { setRemoveError(''); setRemoving(selected) }}><Trash2 size={14} />Remove account</Button>}
      </>}
      <Button variant="ghost" onClick={() => { void appClient.ai.chatgpt.manageUsage().catch(reportError) }}><ExternalLink size={13} />Manage usage</Button>
    </div>
    {account?.signingIn && <form className="chatgpt-callback" onSubmit={event => { event.preventDefault(); void perform(async () => { const value = await appClient.ai.chatgpt.completeCallback(callbackUrl.trim()); setCallbackUrl(''); return value }) }}>
      <p id="chatgpt-callback-help">If the sign-in tab stops at 127.0.0.1, copy its full address and paste it below. No SSH tunnel is needed.</p>
      <label htmlFor="chatgpt-callback-url">Callback URL</label>
      <input id="chatgpt-callback-url" type="password" autoComplete="off" spellCheck={false} aria-describedby="chatgpt-callback-help" placeholder="Paste the full URL from the sign-in tab" value={callbackUrl} maxLength={20000} disabled={busy} onChange={event => setCallbackUrl(event.target.value)} />
      <Button type="submit" variant="primary" busy={busy} disabled={!callbackUrl.trim()}>Finish connection</Button>
    </form>}
    {(message || account?.error) && <p className="provider-error" role="alert">{message || account?.error}</p>}
    <Dialog.Root open={!!removing} onOpenChange={open => { if (!open && !busy) setRemoving(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog account-remove-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
      <div className="folder-dialog-heading"><Dialog.Title>Remove saved ChatGPT account?</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close remove account dialog" disabled={busy}><X size={17} /></Button></Dialog.Close></div>
      <Dialog.Description><strong>{removing?.label} · {removing?.email ?? removing?.name ?? 'ChatGPT account'}</strong> will be removed from this app, including its saved sign-in credentials. This does not delete your ChatGPT account or your recordings. You can add the account again later.</Dialog.Description>
      {removeError && <p className="provider-error" role="alert">{removeError}</p>}
      <div className="dialog-actions"><Button disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => { void removeAccount() }}>Remove account</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={account?.welcomePending ?? false} onOpenChange={open => { if (!open) void perform(() => appClient.ai.chatgpt.acknowledgeWelcome()) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog">
      <Dialog.Title>You’re using your ChatGPT plan</Dialog.Title><Dialog.Description>HiDockNotes summaries, action items and Assistant answers can now use your ChatGPT plan allowance or credits. Manage this app’s access and limits in ChatGPT settings. Audio transcription uses the separate provider selected in HiDockNotes.</Dialog.Description>
      <div className="dialog-actions"><Button onClick={() => { void appClient.ai.chatgpt.manageUsage().catch(reportError) }}>Manage usage</Button><Button variant="primary" disabled={busy} onClick={() => { void perform(() => appClient.ai.chatgpt.acknowledgeWelcome()) }}>Got it</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
