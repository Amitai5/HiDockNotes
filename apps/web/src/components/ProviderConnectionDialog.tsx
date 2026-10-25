import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { RefreshCw, Trash2, X } from 'lucide-react'
import { appClient } from '../services/app-client'
import type { AIState, ChatProviderId, ProviderId } from '../shared/ai'
import { Button } from './ui'
import { ChatGPTAccountPanel } from './ChatGPTAccountPanel'

export interface ProviderConnectionSelection { provider: ChatProviderId; kind: 'transcription' | 'chat' }
export const providerNames = { gemini: 'Google Gemini', openai: 'OpenAI', chatgpt: 'ChatGPT' }
export function ProviderConnectionDialog({ selection, state, accept, useProvider, close }: { selection: ProviderConnectionSelection; state: AIState; accept(value: AIState): void; useProvider(value: AIState): Promise<void>; close(): void }): JSX.Element {
  const [key, setKey] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const provider = selection.provider, name = providerNames[provider], saved = state.providers.find(item => item.provider === provider)
  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not update this connection. Check the key and your connection.') }
    finally { setKey(''); setBusy(false) }
  }
  async function verify(): Promise<void> {
    if (provider === 'chatgpt') return
    const value = await appClient.ai.verifyKey(provider, key)
    accept(value); await useProvider(value)
  }
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) close() }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog provider-connection-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }} onCloseAutoFocus={event => { event.preventDefault(); document.getElementById(`provider-${selection.kind}`)?.focus() }}>
    <div className="folder-dialog-heading"><Dialog.Title>{name} connection</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close provider connection" disabled={busy}><X size={17} /></Button></Dialog.Close></div>
    <Dialog.Description>{selection.kind === 'transcription' ? `Connect ${name} to transcribe audio from your server.` : `Connect ${name} for chat and summaries.`} {provider === 'chatgpt' ? 'Use your plan account below.' : 'API keys are encrypted on your server. Saved keys are never displayed.'}</Dialog.Description>
    {provider === 'chatgpt' ? <ChatGPTAccountPanel state={state} accept={accept} /> : <>
      <p className="provider-connection-status">{saved?.verified ? 'Verified connection' : saved?.configured ? 'A key is saved. Verify it to use this provider.' : 'Not configured'}</p>
      <form className="provider-key-form" onSubmit={event => { event.preventDefault(); void perform(verify) }}>
        <label htmlFor="provider-api-key">{provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key</label>
        <input id="provider-api-key" type="password" autoComplete="off" spellCheck={false} placeholder={saved?.configured ? 'Enter a replacement key' : 'Paste API key'} value={key} maxLength={1000} disabled={busy} onChange={event => setKey(event.target.value)} />
        <Button type="submit" variant="primary" busy={busy} disabled={!key.trim()}>Verify &amp; save</Button>
      </form>
      {provider === 'gemini' && <p className="provider-disclosure">Free-tier inputs may be reviewed by Google.</p>}
      {saved?.configured && <div className="provider-tools"><Button variant="ghost" disabled={busy} onClick={() => { void perform(async () => { accept(await appClient.ai.refreshModels(provider as ProviderId)); setMessage('Model list refreshed.') }) }}><RefreshCw size={13} />Refresh models</Button><Button variant="ghost" disabled={busy} onClick={() => { void perform(async () => { accept(await appClient.ai.removeKey(provider as ProviderId)); setMessage('Encrypted key removed.') }) }}><Trash2 size={13} />Remove key</Button></div>}
    </>}
    {message && <p role="status" className="provider-success">{message}</p>}{error && <p role="alert" className="provider-error">{error}</p>}
    <div className="dialog-actions"><Button disabled={busy} onClick={close}>Cancel</Button><Button variant="primary" disabled={busy || !!key.trim() || (provider === 'chatgpt' ? !state.chatgpt?.planEnabled : !saved?.verified)} onClick={() => { void perform(() => useProvider(state)) }}>Use {name}</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
