import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { RotateCcw, Sparkles, X } from 'lucide-react'
import type { RecordingReprocessMode } from '../shared/meeting'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export function RecordingReprocess({ id, canSummarize, canTranscribe, onQueued, mode: controlledMode, onModeChange, onClosed }: { id: string; canSummarize: boolean; canTranscribe: boolean; onQueued(): void; mode?: RecordingReprocessMode | null; onModeChange?(mode: RecordingReprocessMode | null): void; onClosed?(): void }): JSX.Element {
  const [localMode, setLocalMode] = useState<RecordingReprocessMode | null>(null)
  const mode = controlledMode === undefined ? localMode : controlledMode
  const setMode = onModeChange ?? setLocalMode
  const [busy, setBusy] = useState(false)
  async function confirm(): Promise<void> {
    if (!mode) return
    setBusy(true)
    try { await window.electronAPI.ai.reprocess(id, mode); setMode(null); onQueued() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <>{controlledMode === undefined && <><Button disabled={!canSummarize} onClick={() => setMode('summarize')} title="Generate new notes from the saved transcript using your current summary settings"><Sparkles size={15} />Resummarize</Button><Button disabled={!canTranscribe} onClick={() => setMode('transcribe')} title="Transcribe the saved audio again, then regenerate the summary"><RotateCcw size={15} />Retranscribe</Button></>}
    <Dialog.Root open={mode !== null} onOpenChange={open => { if (!open && !busy) setMode(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog" onCloseAutoFocus={event => { if (onClosed) { event.preventDefault(); onClosed() } }}><div className="panel-heading"><Dialog.Title>{mode === 'transcribe' ? 'Retranscribe this recording?' : 'Resummarize this recording?'}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close processing dialog" disabled={busy}><X size={17} /></Button></Dialog.Close></div><Dialog.Description>{mode === 'transcribe' ? 'The saved audio will be transcribed again with your current transcription settings. A new summary, participants, tags and action items will follow automatically.' : 'Your saved transcript will be used to regenerate the summary, meeting type, participants, tags and action items. The audio will not be transcribed again.'} Existing notes stay available while processing. Your custom title, manual tags and completed action items are preserved.</Dialog.Description><div className="dialog-actions"><Button disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => { void confirm() }}>{mode === 'transcribe' ? 'Retranscribe and summarize' : 'Generate summary'}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root></>
}
