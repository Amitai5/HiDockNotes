import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { RotateCcw, Sparkles, X } from 'lucide-react'
import type { RecordingReprocessMode } from '../shared/meeting'
import { Button } from './ui'
import { reportError } from '../store/useAppStore'

export function RecordingReprocess({ expectedSpeakers, id, canSummarize, canTranscribe, onQueued, mode: controlledMode, onModeChange, onClosed }: { expectedSpeakers?: number | null; id: string; canSummarize: boolean; canTranscribe: boolean; onQueued(): void; mode?: RecordingReprocessMode | null; onModeChange?(mode: RecordingReprocessMode | null): void; onClosed?(): void }): JSX.Element {
  const [localMode, setLocalMode] = useState<RecordingReprocessMode | null>(null)
  const mode = controlledMode === undefined ? localMode : controlledMode
  const setMode = onModeChange ?? setLocalMode
  const [busy, setBusy] = useState(false)
  const [speakerCount, setSpeakerCount] = useState('')
  useEffect(() => { if (mode === 'transcribe') setSpeakerCount(expectedSpeakers == null ? '' : String(expectedSpeakers)) }, [mode, id, expectedSpeakers])
  async function confirm(): Promise<void> {
    if (!mode || mode === 'transcribe' && !speakerCount) return
    setBusy(true)
    try { if (mode === 'transcribe') await appClient.library.setSpeakerCount(id, speakerCount === 'auto' ? null : Number(speakerCount)); await appClient.ai.reprocess(id, mode); setMode(null); onQueued() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  return <>{controlledMode === undefined && <><Button disabled={!canSummarize} onClick={() => setMode('summarize')} title="Generate new notes from the saved transcript using your current summary settings"><Sparkles size={15} />Resummarize</Button><Button disabled={!canTranscribe} onClick={() => setMode('transcribe')} title="Transcribe the saved audio again, then regenerate the summary"><RotateCcw size={15} />Retranscribe</Button></>}
    <Dialog.Root open={mode !== null} onOpenChange={open => { if (!open && !busy) setMode(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog" onCloseAutoFocus={event => { if (onClosed) { event.preventDefault(); onClosed() } }}><div className="panel-heading"><Dialog.Title>{mode === 'transcribe' ? 'Retranscribe this recording?' : 'Resummarize this recording?'}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close processing dialog" disabled={busy}><X size={17} /></Button></Dialog.Close></div><Dialog.Description>{mode === 'transcribe' ? 'The saved audio will be transcribed again with your current transcription settings. If you have corrected this transcript, you will compare the new version before applying it. A new summary, participants, tags and action items follow automatically after you apply it.' : 'Your saved transcript will be used to regenerate the summary, meeting type, participants, tags and action items. The audio will not be transcribed again.'} Existing notes stay available while processing. Your custom title, manual tags and completed action items are preserved.</Dialog.Description>{mode === 'transcribe' && <label className="note-field">How many speakers are in this recording?<select aria-label="Speakers for retranscription" value={speakerCount} disabled={busy} onChange={event => setSpeakerCount(event.target.value)}><option value="" disabled>Choose speaker count</option><option value="auto">Auto detect · prefers 1–3</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} speaker{index === 0 ? '' : 's'}</option>)}</select></label>}<div className="dialog-actions"><Button disabled={busy} onClick={() => setMode(null)}>Cancel</Button><Button variant="primary" busy={busy} disabled={mode === 'transcribe' && !speakerCount} onClick={() => { void confirm() }}>{mode === 'transcribe' ? 'Retranscribe and summarize' : 'Generate summary'}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root></>
}
