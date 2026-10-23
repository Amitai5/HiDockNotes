import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { BrainCircuit, Download, X } from 'lucide-react'
import { useSemanticSearch } from '../hooks/useSemanticSearch'
import { reportError } from '../store/useAppStore'
import { Button, Toggle } from './ui'

export function SemanticSearchSettings(): JSX.Element {
  const state = useSemanticSearch()
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false)
  async function act(action: () => Promise<unknown>): Promise<void> { setBusy(true); try { await action() } catch (error) { reportError(error) } finally { setBusy(false) } }
  return <section className="settings-section" id="meaning-search" tabIndex={-1}><h2><BrainCircuit size={18} />Search by meaning</h2><div className="setting-row"><div><strong>Local meaning search</strong><p>Find related ideas in Library and Assistant. English model · 24 MB download.</p></div><Toggle label="Local meaning search" checked={state.enabled} disabled={busy} onChange={value => { void act(value ? appClient.semanticSearch.enable : appClient.semanticSearch.disable) }} /></div>
    <div className="semantic-model-card"><div><strong>{state.phase === 'downloading' ? 'Downloading model…' : state.phase === 'waiting' ? 'Waiting for transcription…' : state.phase === 'indexing' ? 'Indexing recordings…' : state.phase === 'failed' ? 'Search needs attention' : state.modelReady ? 'Model downloaded' : 'Optional model'}</strong><span>{state.modelReady ? `${state.indexedRecordings} of ${state.totalRecordings} recordings indexed` : 'Runs on your server. No notes leave your server.'}</span></div><div className="toolbar-actions">{(!state.enabled || state.phase === 'failed') && <Button variant="primary" disabled={busy} onClick={() => { void act(appClient.semanticSearch.enable) }}><Download size={15} />{state.phase === 'failed' ? 'Retry setup' : state.modelReady ? 'Enable' : 'Download & enable'}</Button>}{state.modelReady && <Button disabled={busy} onClick={() => setConfirm(true)}>Remove model</Button>}{(state.phase === 'downloading' || state.phase === 'indexing') && <Button disabled={busy} onClick={() => { void act(appClient.semanticSearch.disable) }}>Stop</Button>}</div></div>
    {(state.phase === 'downloading' || state.phase === 'indexing') && <progress max={1} value={state.progress} aria-label={state.phase === 'downloading' ? 'Search model download' : 'Search indexing progress'} />}{state.error && <p role="alert" className="danger-text">{state.error}</p>}
    <Dialog.Root open={confirm} onOpenChange={value => { if (!busy) setConfirm(value) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog"><div className="panel-heading"><Dialog.Title>Remove search model?</Dialog.Title><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label="Close model removal"><X size={17} /></Button></Dialog.Close></div><Dialog.Description>Remove the downloaded model and its search index. Your recordings, chats, and notes are kept.</Dialog.Description><div className="dialog-actions"><Button disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => { void act(async () => { await appClient.semanticSearch.removeModel(true); setConfirm(false) }) }}>Remove model</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>
}

export function OptionalSearchSetup(): JSX.Element | null {
  const state = useSemanticSearch()
  if (!appClient.semanticSearch || state.setupOffered || state.enabled) return null
  return <div className="optional-search-setup"><BrainCircuit size={22} /><div><strong>Optional: search by meaning</strong><span>Download a 24 MB model for private, local search.</span></div><Button variant="primary" onClick={() => { void appClient.semanticSearch.enable().catch(reportError) }}>Download & enable</Button><Button variant="ghost" onClick={() => { void appClient.semanticSearch.dismissSetup().catch(reportError) }}>Skip</Button></div>
}
