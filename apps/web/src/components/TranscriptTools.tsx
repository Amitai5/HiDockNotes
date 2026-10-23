import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useState } from 'react'
import { GitCompareArrows, History, Pencil, Sparkles, X } from 'lucide-react'
import type { TranscriptSegment } from '../shared/contracts'
import type { TranscriptCandidateChoice, TranscriptReview } from '../shared/transcript'
import { Button, formatDuration } from './ui'
import { reportError } from '../store/useAppStore'

function TranscriptExcerpt({ segments }: { segments: TranscriptSegment[] }): JSX.Element {
  const [count, setCount] = useState(100)
  useEffect(() => setCount(100), [segments])
  return <div className="revision-excerpts">{segments.slice(0, count).map(segment => <div key={segment.id}><small>{formatDuration(segment.start)} · {segment.speakerName ?? 'Unknown speaker'}</small><p>{segment.text}</p></div>)}{count < segments.length && <Button onClick={() => setCount(value => value + 100)}>Show more excerpts ({segments.length - count} remaining)</Button>}</div>
}
export function TranscriptTools({ recordingId, segments, edit, onCloseEdit, onChanged, disabled }: { recordingId: string; segments: TranscriptSegment[]; edit: TranscriptSegment | null; onCloseEdit(): void; onChanged(): void; disabled: boolean }): JSX.Element | null {
  const api = appClient.transcripts
  const [review, setReview] = useState<TranscriptReview | null>(null)
  const [mode, setMode] = useState<'history' | 'compare' | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [target, setTarget] = useState<number | null>(null)
  const [revision, setRevision] = useState<TranscriptSegment[]>([])
  const [choice, setChoice] = useState<TranscriptCandidateChoice>('keep-corrections')
  const refresh = useCallback(() => { if (api) void api.review(recordingId).then(setReview).catch(reportError) }, [api, recordingId])
  useEffect(() => { refresh() }, [refresh, segments])
  useEffect(() => { setText(edit?.text ?? '') }, [edit])
  useEffect(() => {
    if (!api || target === null) return
    let current = true; setRevision([])
    void api.revision(recordingId, target).then(value => { if (current) setRevision(value) }).catch(reportError)
    return () => { current = false }
  }, [api, target, recordingId])
  if (!api || !review) return null
  async function run(operation: () => Promise<TranscriptReview>): Promise<void> {
    setBusy(true)
    try { setReview(await operation()); onChanged(); onCloseEdit(); setMode(null); setTarget(null) }
    catch (error) { reportError(error); refresh() }
    finally { setBusy(false) }
  }
  return <div className="transcript-tools">
    <div className="transcript-tools-row"><small className="muted">Edit an excerpt to correct its words.</small><Button variant="ghost" onClick={() => { setMode('history'); setTarget(review.revisions[0]?.version ?? null) }} disabled={!review.revisions.length}><History size={14} />History</Button></div>
    {review.summaryStale && !review.candidate && <p className="transcript-notice"><Sparkles size={14} />Transcript changed. Resummarize to update the meeting notes.</p>}
    {review.candidate && <div className="transcript-review-notice"><GitCompareArrows size={18} /><div><strong>New transcription ready</strong><p>Your corrections and existing notes are still in use.</p></div><Button onClick={() => { setChoice('keep-corrections'); setMode('compare') }}>Compare</Button></div>}
    <Dialog.Root open={!!edit || mode !== null} onOpenChange={open => { if (!open && !busy) { setMode(null); onCloseEdit() } }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className={edit ? 'confirmation-dialog transcript-edit-dialog' : 'confirmation-dialog transcript-review-dialog'} onEscapeKeyDown={event => { if (busy) event.preventDefault() }} onInteractOutside={event => { if (busy) event.preventDefault() }}>
      <div className="panel-heading"><Dialog.Title>{edit ? <><Pencil size={19} />Edit transcript excerpt</> : mode === 'history' ? <><History size={19} />Transcript history</> : <><GitCompareArrows size={19} />Compare new transcription</>}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close transcript dialog" disabled={busy}><X size={18} /></Button></Dialog.Close></div>
      <Dialog.Description>{edit ? 'Correct the words while keeping the original timestamp and speaker. Every saved change can be recovered from History.' : mode === 'history' ? 'Review a saved version. Restoring it creates another revision and keeps your existing history.' : 'Choose the transcript to use. Applying it automatically regenerates the summary and action items.'}</Dialog.Description>
      {edit ? <><label className="field-label" htmlFor="transcript-edit-text">{formatDuration(edit.start)}–{formatDuration(edit.end)} · {edit.speakerName ?? 'Unknown speaker'}</label><textarea id="transcript-edit-text" aria-label="Transcript excerpt" rows={8} maxLength={30000} value={text} onChange={event => setText(event.target.value)} autoFocus disabled={busy} /><div className="dialog-actions"><Button disabled={busy} onClick={onCloseEdit}>Cancel</Button><Button variant="primary" busy={busy} disabled={disabled || !text.trim() || text.trim() === edit.text} onClick={() => { void run(() => api.edit(recordingId, edit.id, text, review.version)) }}>Save correction</Button></div></>
        : mode === 'history' ? <><div className="transcript-history-layout"><div className="revision-list" aria-label="Transcript versions">{review.revisions.map(item => <button key={item.version} aria-pressed={target === item.version} onClick={() => setTarget(item.version)}><strong>{item.reason}</strong><span>{new Date(item.createdAt).toLocaleString()}</span><small>{item.segmentCount} excerpts{item.version === review.version ? ' · Current' : ''}</small></button>)}</div><div className="revision-content"><TranscriptExcerpt segments={revision} /></div></div><div className="dialog-actions"><Button disabled={busy} onClick={() => setMode(null)}>Close</Button><Button variant="primary" busy={busy} disabled={disabled || target === null || target === review.version || !revision.length} onClick={() => { if (target !== null) void run(() => api.restore(recordingId, target, review.version)) }}>Restore this version</Button></div></>
        : review.candidate && <><label className="field-label" htmlFor="transcript-merge-choice">Use this version</label><select id="transcript-merge-choice" value={choice} onChange={event => setChoice(event.target.value as TranscriptCandidateChoice)} disabled={busy}><option value="keep-corrections">New transcription, keeping my corrections</option><option value="replace">New transcription in full</option><option value="discard">Keep my current transcript</option></select>
          {choice === 'keep-corrections' && <p className="muted">Corrected excerpts keep their exact words and timestamps. Any new excerpt overlapping a correction is replaced in full. Review the proposed transcript below.</p>}
          <div className="transcript-comparison"><section><h3>New transcription</h3><TranscriptExcerpt segments={review.candidate.segments} /></section><section><h3>{choice === 'discard' ? 'Current transcript will be kept' : choice === 'replace' ? 'Proposed transcript · new version' : 'Proposed transcript · corrections retained'}</h3>{choice === 'discard' ? <p className="muted">Your saved transcript and notes stay as they are. The new transcription will be discarded.</p> : <TranscriptExcerpt segments={choice === 'replace' ? review.candidate.segments : review.candidate.merged} />}</section></div>
          <div className="dialog-actions"><Button disabled={busy} onClick={() => setMode(null)}>Review later</Button><Button variant="primary" busy={busy} disabled={disabled} onClick={() => { void run(() => api.accept(recordingId, choice, review.version)) }}>{choice === 'discard' ? 'Keep current transcript' : 'Apply and resummarize'}</Button></div></>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
