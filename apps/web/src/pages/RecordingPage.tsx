import { appClient } from '../services/app-client'
import { libraryUrl } from '../services/note-url'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, CalendarDays, CheckCircle2, FileText, Folder, ListChecks, LoaderCircle, Pause, Pencil, Play, SkipBack, Sparkles, Tags, UsersRound, Volume2 } from 'lucide-react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ProjectView, RecordingDetail, RecordingView, TranscriptSegment } from '../shared/contracts'
import type { AIState, SpeakerView } from '../shared/ai'
import { Button, formatDuration } from '../components/ui'
import { RecordingTitle } from '../components/RecordingTitle'
import { MarkdownContent } from '../components/MarkdownContent'
import { ActionableList } from '../components/ActionableList'
import { reportError } from '../store/useAppStore'
import { RecordingWorkspace } from '../components/RecordingWorkspace'
import { RecordingTags } from '../components/RecordingTags'
import { RecordingParticipants } from '../components/RecordingParticipants'
import { RecordingActions } from '../components/RecordingActions'
import { SpeakerEditor, speakerColors, type SpeakerEdit } from '../components/SpeakerEditor'
import { useRecordingPlayback } from '../hooks/useRecordingPlayback'
import { ProcessingControls } from '../components/ProcessingControls'
import { TranscriptTools } from '../components/TranscriptTools'
import { RecordingCalendar } from '../components/RecordingCalendar'
import { labelTranscriptSpeakers } from '../services/transcript-speaker-labels'

const ACTIVE_STAGES = ['queued', 'converting', 'diarizing', 'transcribing', 'identifying', 'summarizing']
export function RecordingPage({ onRecordingChange }: { onRecordingChange?(recording: RecordingView): void } = {}): JSX.Element {
  const { id } = useParams()
  return id ? <RecordingContent key={id} id={id} onRecordingChange={onRecordingChange} /> : <div className="page"><p className="muted">Recording was not found.</p></div>
}
function RecordingContent({ id, onRecordingChange }: { id: string; onRecordingChange?(recording: RecordingView): void }): JSX.Element {
  const navigate = useNavigate()
  const deleting = useRef(false)
  const [query] = useSearchParams()
  const [detail, setDetail] = useState<RecordingDetail | null>(null)
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [ai, setAI] = useState<AIState | null>(null)
  const [waveform, setWaveform] = useState<{ peaks: number[]; duration: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [speaker, setSpeaker] = useState<SpeakerEdit | null>(null)
  const [edit, setEdit] = useState<TranscriptSegment | null>(null)
  const speakerTrigger = useRef<HTMLElement | null>(null)
  const transcriptSegments = useMemo(() => labelTranscriptSpeakers(detail?.segments ?? [], detail?.speakers), [detail?.segments, detail?.speakers])
  const colors = useMemo(() => speakerColors(transcriptSegments.map(segment => segment.speakerName ?? 'Unassigned speech')), [transcriptSegments])
  const { audio, position, playing, loading, rate, seek, playPause, changeRate, suspend } = useRecordingPlayback(id, !!detail?.recording.hasAudio, Number(query.get('t')) || 0)
  const refresh = useCallback(() => { if (id && !deleting.current) void appClient.library.detail(id).then(value => { if (!deleting.current) setDetail(value) }).catch(error => { if (!deleting.current) reportError(error) }) }, [id])
  useEffect(() => {
    let mounted = true
    setDetail(null); setWaveform(null)
    const load = (): void => {
      if (id && !deleting.current) void appClient.library.detail(id).then(value => { if (mounted && !deleting.current) setDetail(value) }).catch(error => { if (mounted && !deleting.current) reportError(error) })
      void appClient.ai.getState().then(value => { if (mounted) setAI(value) }).catch(reportError)
    }
    load()
    void appClient.projects.list().then(value => { if (mounted) setProjects(value) }).catch(reportError)
    const unsubscribe = appClient.library.onChanged(load)
    return () => { mounted = false; unsubscribe() }
  }, [id])
  useEffect(() => {
    let mounted = true
    if (id && detail?.recording.hasAudio) void appClient.library.waveform(id).then(value => { if (mounted && !deleting.current) setWaveform(value) }).catch(error => { if (mounted && !deleting.current) reportError(error) })
    return () => { mounted = false }
  }, [id, detail?.recording.hasAudio])
  useEffect(() => { if (detail) onRecordingChange?.(detail.recording) }, [detail?.recording, onRecordingChange])
  const duration = waveform?.duration ?? detail?.recording.duration ?? 0
  async function process(): Promise<void> { if (!id) return; setBusy(true); try { await appClient.ai.process(id); refresh() } catch (error) { reportError(error) } finally { setBusy(false) } }
  function openSpeaker(value: SpeakerEdit): void { speakerTrigger.current = document.activeElement as HTMLElement | null; setSpeaker(value) }
  function editSpeaker(value: SpeakerView): void { openSpeaker({ speaker: value }) }
  if (!detail || !id) return <div className="page"><p className="muted">Loading recording…</p></div>
  const processing = detail.processing
  const processingReady = processing?.mode === 'summarize' ? ai?.summaryReady : ai?.ready
  const processingReason = processing?.mode === 'summarize' ? ai?.summaryReason : ai?.reason
  const active = ACTIVE_STAGES.includes(detail.recording.status)
  const retry = detail.recording.status === 'failed'
  const canProcess = !detail.deletionPending && detail.recording.verified && ['downloaded', 'failed', 'empty'].includes(detail.recording.status)
  const pendingSummary = detail.recording.status === 'done' && !detail.recording.summary && detail.segments.length > 0
  return <>
    <RecordingWorkspace notes={<div className="page recording-detail">
    <Link className="back-link" to={libraryUrl(detail.recording.projectId)}><ArrowLeft size={15} />Back to {projects.find(project => project.id === detail.recording.projectId)?.name ?? (detail.recording.projectId ? 'project' : 'Unfiled items')}</Link>
    <div className="page-heading"><div><RecordingTitle id={id} title={detail.recording.title || detail.recording.filename} onSaved={refresh} /><p className="recording-verification">{detail.recording.verified && <><CheckCircle2 size={12} />Local copy verified</>}</p></div><RecordingActions key={id} expectedSpeakers={detail.expectedSpeakers} recording={detail.recording} canSummarize={!detail.deletionPending && !active && detail.segments.length > 0 && !!ai?.summaryReady} canTranscribe={!detail.deletionPending && !active && detail.recording.verified && detail.recording.hasAudio && !!ai?.ready && !!ai?.summaryReady} canProcess={canProcess} processReady={!!ai?.ready} retry={retry} busy={busy} onProcess={() => { void process() }} onQueued={refresh} onDeleting={value => { deleting.current = value; suspend(value) }} onDeleted={() => navigate(libraryUrl(detail.recording.projectId))} /></div>
    <dl className="recording-overview" aria-label="Recording overview">
      <div><dt><CalendarDays size={14} />Recorded</dt><dd><time dateTime={detail.recording.recordedAt}>{new Date(detail.recording.recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time><small>{new Date(detail.recording.recordedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {formatDuration(duration)}</small></dd></div>
      <div><dt><Folder size={14} />Project</dt><dd><Link className="metadata-project" to={detail.recording.projectId ? `/library?project=${encodeURIComponent(detail.recording.projectId)}` : '/library?scope=unfiled'}>{projects.find(project => project.id === detail.recording.projectId)?.name ?? (detail.recording.projectId ? 'Project folder' : 'Unfiled')}</Link></dd></div>
      <div><dt><FileText size={14} />Meeting type</dt><dd>{detail.meeting?.meetingType ?? <span className="muted">Not summarized yet</span>}</dd></div>
      <div className="overview-participants"><dt><UsersRound size={14} />Participants</dt><dd><RecordingParticipants detail={detail} onEdit={editSpeaker} /><label className="speaker-count-control">Speakers on retranscribe<select aria-label="Speaker count" disabled={active || detail.deletionPending} value={detail.expectedSpeakers ?? 'auto'} onChange={event => { void appClient.library.setSpeakerCount(id, event.target.value === 'auto' ? null : Number(event.target.value)).then(refresh).catch(reportError) }}><option value="auto">Auto · prefers 1–3</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label></dd>{detail.speakerLimitReached && <small className="muted">Review uncertain speaker labels.</small>}</div>
      <div className="overview-tags"><dt><Tags size={14} />Tags</dt><dd><RecordingTags key={id} id={id} tags={detail.tags ?? []} onSaved={refresh} /></dd></div>
    </dl>
    <RecordingCalendar id={id} disabled={detail.deletionPending} />
    {ai?.queue?.reviewPaused && (active || canProcess || pendingSummary) ? <div className="processing-banner" role="status"><div><Sparkles size={17} /><strong>{processing?.mode === 'summarize' ? 'Summary refresh is paused.' : 'Background processing is paused.'}</strong></div><p>{processing?.mode === 'summarize' ? 'Your transcript is saved. Resume processing to refresh the summary.' : 'Resume processing to continue with your selected transcription and summary providers.'}</p><ProcessingControls state={ai} onChanged={setAI} /></div> : (active || retry || detail.recording.status === 'empty' || canProcess && !processingReady) && <div className={`processing-banner ${retry ? 'processing-failed' : ''}`} role="status"><div>{active && processingReady ? <LoaderCircle className="animate-spin" size={17} /> : <Sparkles size={17} />}<strong>{!processingReady && (active || canProcess) ? processingReason ?? 'Loading AI settings…' : processing?.message ?? (retry ? 'Processing failed.' : detail.recording.status === 'empty' ? 'No usable audio was detected.' : 'Waiting to process…')}</strong>{!processingReady && <Link to="/settings?tab=ai">Set up AI</Link>}</div>{processing?.error && <p>{processing.error}{processing.nextAttemptAt ? ` Automatic retry at ${new Date(processing.nextAttemptAt).toLocaleTimeString()}.` : ''}</p>}{active && processingReady && <progress aria-label={`${detail.recording.status} progress`} max={1} value={processing?.progress ?? 0} />}</div>}
    {detail.deletionPending && <div className="processing-banner danger" role="status"><div><strong>Deletion needs to be completed.</strong><p>Use Delete recording in the menu again to finish the device check and local cleanup.</p></div></div>}
    <div className="recording-notes">
      <section className="recording-summary-section" aria-labelledby="summary-heading"><h2 id="summary-heading"><Sparkles size={18} />Summary</h2>
        {detail.recording.summary ? <MarkdownContent hideActionItems>{detail.recording.summary}</MarkdownContent> : <p className="muted recording-summary-empty">{pendingSummary ? 'Your local transcript is ready. Connect a summary provider in Settings to add a summary and action items automatically.' : detail.segments.length && retry ? 'The transcript was saved. Retry processing to finish the summary.' : active ? 'A summary will appear when processing finishes.' : 'Process this recording to create a summary.'}</p>}
        {pendingSummary && <Link to="/settings">Set up summaries</Link>}
      </section>
      <section className="recording-actions" aria-labelledby="recording-actions-heading"><h2 id="recording-actions-heading"><ListChecks size={18} />Action items</h2><ActionableList items={detail.actionables} onChanged={refresh} onSeek={seek} emptyText={detail.recording.summary ? 'No explicit action items were found.' : 'Action items will be extracted when a summary provider is connected.'} /></section>
    </div>
    </div>} media={<>
      <div className="recording-playback"><h2><Play size={15} />Audio recording</h2>
    {detail.recording.hasAudio ? <div className="audio-player"><audio ref={audio} src={`/api/v1/recordings/${id}/audio`} preload="metadata" /><div className="waveform" role="slider" tabIndex={0} aria-label="Seek in recording" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={position} onKeyDown={event => { if (event.key === 'ArrowRight') seek(Math.min(duration, position + 5)); if (event.key === 'ArrowLeft') seek(Math.max(0, position - 5)) }} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); seek(Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration))) }}><svg viewBox="0 0 720 84" preserveAspectRatio="none" aria-hidden="true">{waveform ? waveform.peaks.map((peak, index) => <rect key={index} x={index * 4} y={42 - Math.max(2, peak * 38)} width="2.5" height={Math.max(4, peak * 76)} rx="1.2" fill={index / waveform.peaks.length <= position / duration ? 'var(--accent)' : 'var(--wave-muted)'} />) : <line x1="0" y1="42" x2="720" y2="42" stroke="var(--border)" />}</svg></div><div className="player-controls"><Button variant="ghost" aria-label="Back 10 seconds" onClick={() => seek(Math.max(0, position - 10))}><SkipBack size={18} /></Button><Button className="play-button" variant="primary" aria-label={loading ? 'Cancel playback' : playing ? 'Pause audio' : 'Play audio'} onClick={() => { void playPause() }}>{loading ? <LoaderCircle className="animate-spin" size={19} /> : playing ? <Pause size={19} /> : <Play size={19} />}</Button><span className="player-time">{formatDuration(position)} <span>/ {formatDuration(duration)}</span></span><select aria-label="Playback speed" value={rate} onChange={event => changeRate(Number(event.target.value))}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><div className="player-volume"><Volume2 size={17} /><input aria-label="Audio volume" type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={event => { if (audio.current) audio.current.volume = Number(event.target.value) }} /></div></div></div> : <div className="inline-empty">Download this recording from Sync to play it here.</div>}
      </div>
      <section className="recording-transcript" aria-labelledby="transcript-heading"><h2 id="transcript-heading"><FileText size={18} />Transcript</h2>
      <TranscriptTools recordingId={id} segments={detail.segments} edit={edit} onCloseEdit={() => setEdit(null)} onChanged={refresh} disabled={active || busy} />
      {detail.segments.length ? transcriptSegments.map(segment => {
        const voice = detail.speakers?.find(value => value.id === segment.speakerId)
        const label = segment.speakerName ?? voice?.label ?? 'Unassigned speech'
        return <div key={segment.id} className={`transcript-segment ${position >= segment.start && position < segment.end ? 'current' : ''}`}><button className="transcript-time" aria-label={`Play from ${formatDuration(segment.start)}`} onClick={() => seek(segment.start)}><time>{formatDuration(segment.start)}</time></button><span>{<button className={`speaker-label ${colors.get(label.trim().toLowerCase()) ?? 'speaker-unknown'}`} aria-label={voice ? `Rename ${label}` : `Assign speaker at ${formatDuration(segment.start)}`} onClick={() => openSpeaker(voice ? { speaker: voice } : { segment })}><strong>{label}</strong><Pencil size={12} /></button>}{voice?.suggestedName && <Button className="speaker-suggestion" variant="ghost" onClick={() => { void appClient.voices.confirmSpeaker(voice.id).then(refresh).catch(reportError) }}>Possibly {voice.suggestedName}? <CheckCircle2 size={12} /></Button>}<button className="transcript-text" onClick={() => seek(segment.start)}>{segment.text}</button><button className="transcript-edit-button" aria-label={`Edit excerpt at ${formatDuration(segment.start)}`} title="Edit transcript excerpt" disabled={active || busy} onClick={() => setEdit(segment)}><Pencil size={13} /></button></span></div>
      }) : <div className="inline-empty">{active ? 'The transcript will appear here as soon as transcription finishes.' : detail.recording.status === 'empty' ? 'This recording contains silence or no usable audio.' : !detail.recording.hasAudio ? 'Download the audio first, then the app can transcribe it.' : 'Set up AI in Settings to turn this recording into a transcript, summary and action items.'}</div>}
    </section>
    </>} />
    <SpeakerEditor recordingId={id} edit={speaker} onClose={() => setSpeaker(null)} onSaved={refresh} onClosed={() => speakerTrigger.current?.focus()} />
  </>
}
