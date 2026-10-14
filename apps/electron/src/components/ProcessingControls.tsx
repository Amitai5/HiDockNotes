import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Play, X } from 'lucide-react'
import type { AIState } from '../shared/ai'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

const cloudNames = { gemini: 'Google Gemini', openai: 'OpenAI', chatgpt: 'ChatGPT' }

export function ProcessingControls({ state, onChanged, allowCancelSummaries = false }: { state: AIState; onChanged(value: AIState): void; allowCancelSummaries?: boolean }): JSX.Element | null {
  const [confirming, setConfirming] = useState(false), [busy, setBusy] = useState(false)
  if (!state.queue?.reviewPaused) return null
  async function resume(): Promise<void> {
    setBusy(true)
    try { onChanged(await window.electronAPI.ai.resumeReview(true)); setConfirming(false) } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  async function cancelSummaries(): Promise<void> {
    setBusy(true)
    try { await window.electronAPI.ai.cancelQueuedSummaries(); onChanged(await window.electronAPI.ai.getState()) } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <>
    <div className="queue-controls"><Button disabled={busy} onClick={() => setConfirming(true)}><Play size={14} />Resume processing</Button>{allowCancelSummaries && !!state.queue.waitingSummaries && <Button disabled={busy} variant="ghost" onClick={() => { void cancelSummaries() }}>Cancel waiting summary refreshes</Button>}</div>
    <Dialog.Root open={confirming} onOpenChange={value => { if (!busy) setConfirming(value) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
      <div className="folder-dialog-heading"><Dialog.Title>Resume background processing?</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close resume dialog" disabled={busy}><X size={17} /></Button></Dialog.Close></div>
      <Dialog.Description>{state.settings.transcription.provider === 'local' ? 'Audio transcription will run locally on this computer.' : `Audio will be sent to ${cloudNames[state.settings.transcription.provider]} for transcription.`} Transcript text will be sent to {cloudNames[state.settings.chat.provider]} using {state.settings.chat.model} for summaries, titles and action items. This also resumes automatic processing with your current settings and may use plan limits or API billing. Voice embeddings remain local.</Dialog.Description>
      <div className="dialog-actions"><Button disabled={busy} onClick={() => setConfirming(false)}>Keep paused</Button><Button variant="primary" busy={busy} onClick={() => { void resume() }}>Resume processing</Button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </>
}
