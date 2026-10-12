import * as Dialog from '@radix-ui/react-dialog'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, CheckCircle2, FileText, Folder, ListChecks, LoaderCircle, Pause, Pencil, Play, SkipBack, Sparkles, Volume2, X } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { ProjectView, RecordingDetail } from '../shared/contracts'
import type { AIState, SpeakerView, VoiceProfileView } from '../shared/ai'
import { Button, formatDuration } from '../components/ui'
import { RecordingTitle } from '../components/RecordingTitle'
import { RecordingExport } from '../components/RecordingExport'
import { MarkdownContent } from '../components/MarkdownContent'
import { ActionableList } from '../components/ActionableList'
import { reportError } from '../store/useAppStore'

const ACTIVE_STAGES = ['queued', 'converting', 'diarizing', 'transcribing', 'identifying', 'summarizing']
export function RecordingPage(): JSX.Element {
  const { id } = useParams()
  const [query] = useSearchParams()
  const [detail, setDetail] = useState<RecordingDetail | null>(null)
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [ai, setAI] = useState<AIState | null>(null)
  const [waveform, setWaveform] = useState<{ peaks: number[]; duration: number } | null>(null)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [busy, setBusy] = useState(false)
  const [speaker, setSpeaker] = useState<SpeakerView | null>(null)
  const [speakerName, setSpeakerName] = useState('')
  const [profiles, setProfiles] = useState<VoiceProfileView[]>([])
  const audio = useRef<HTMLAudioElement>(null)
  const refresh = useCallback(() => { if (id) void window.electronAPI.library.detail(id).then(setDetail).catch(reportError) }, [id])
  useEffect(() => {
    let mounted = true
    setDetail(null); setWaveform(null); setPosition(0)
    const load = (): void => {
      if (id) void window.electronAPI.library.detail(id).then(value => { if (mounted) setDetail(value) }).catch(reportError)
      void window.electronAPI.ai.getState().then(value => { if (mounted) setAI(value) }).catch(reportError)
    }
    load()
    void window.electronAPI.projects.list().then(value => { if (mounted) setProjects(value) }).catch(reportError)
    const unsubscribe = window.electronAPI.library.onChanged(load)
    return () => { mounted = false; unsubscribe() }
  }, [id])
  useEffect(() => {
    let mounted = true
    if (id && detail?.recording.hasAudio) void window.electronAPI.library.waveform(id).then(value => { if (mounted) setWaveform(value) }).catch(reportError)
    return () => { mounted = false }
  }, [id, detail?.recording.hasAudio])
  function seek(value: number): void { if (audio.current) { audio.current.currentTime = Math.max(0, value); setPosition(Math.max(0, value)) } }
  const duration = waveform?.duration ?? detail?.recording.duration ?? 0
  async function playPause(): Promise<void> { if (!audio.current) return; if (playing) audio.current.pause(); else { try { await audio.current.play() } catch (error) { reportError(error) } } }
  async function process(): Promise<void> { if (!id) return; setBusy(true); try { await window.electronAPI.ai.process(id); refresh() } catch (error) { reportError(error) } finally { setBusy(false) } }
  function editSpeaker(value: SpeakerView): void {
    setSpeaker(value); setSpeakerName(value.label)
    void window.electronAPI.voices.list().then(setProfiles).catch(reportError)
  }
  async function saveSpeaker(): Promise<void> {
    if (!speaker) return
    setBusy(true)
    try { await window.electronAPI.voices.nameSpeaker(speaker.id, speakerName); setSpeaker(null); refresh() } catch (error) { reportError(error) } finally { setBusy(false) }
  }
  if (!detail || !id) return <div className="page"><p className="muted">Loading recording…</p></div>
  const processing = detail.processing
  const active = ACTIVE_STAGES.includes(detail.recording.status)
  const retry = detail.recording.status === 'failed'
  const canProcess = detail.recording.verified && ['downloaded', 'failed', 'empty'].includes(detail.recording.status)
  const pendingSummary = detail.recording.status === 'done' && !detail.recording.summary && detail.segments.length > 0
  return <div className="page recording-detail">
    <Link className="back-link" to="/library"><ArrowLeft size={15} />Library</Link>
    <div className="page-heading"><div><RecordingTitle id={id} title={detail.recording.title || detail.recording.filename} onSaved={refresh} /><p>{new Date(detail.recording.recordedAt).toLocaleString()} <span>·</span> {formatDuration(duration)}</p></div><div className="toolbar-actions">{canProcess && <Button variant="primary" busy={busy} disabled={!ai?.ready} onClick={() => { void process() }}><Sparkles size={16} />{retry ? 'Retry processing' : 'Transcribe'}</Button>}<RecordingExport key={id} recording={detail.recording} /></div></div>
    <div className="detail-meta">{detail.recording.verified && <span className="status status-verified"><CheckCircle2 size={13} />Local copy verified</span>}<label><Folder size={15} /><select aria-label="Recording project" value={detail.recording.projectId ?? ''} onChange={event => { const project = event.target.value || null; void window.electronAPI.projects.assign(id, project).then(refresh).catch(reportError) }}><option value="">No project</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label></div>
    {(active || retry || detail.recording.status === 'empty' || canProcess && !ai?.ready) && <div className={`processing-banner ${retry ? 'processing-failed' : ''}`} role="status"><div>{active && ai?.ready ? <LoaderCircle className="animate-spin" size={17} /> : <Sparkles size={17} />}<strong>{!ai?.ready && (active || canProcess) ? ai?.reason ?? 'Loading AI settings…' : processing?.message ?? (retry ? 'Processing failed.' : detail.recording.status === 'empty' ? 'No usable audio was detected.' : 'Waiting to process…')}</strong>{!ai?.ready && <Link to="/settings">Set up AI</Link>}</div>{processing?.error && <p>{processing.error}{processing.nextAttemptAt ? ` Automatic retry at ${new Date(processing.nextAttemptAt).toLocaleTimeString()}.` : ''}</p>}{active && ai?.ready && <progress aria-label={`${detail.recording.status} progress`} max={1} value={processing?.progress ?? 0} />}</div>}
    {detail.recording.hasAudio ? <div className="audio-player"><audio ref={audio} src={`app-media://recording/${id}`} preload="metadata" onLoadedMetadata={() => { const start = Number(query.get('t')); if (Number.isFinite(start) && start > 0) seek(Math.min(start, audio.current?.duration ?? start)) }} onTimeUpdate={() => setPosition(audio.current?.currentTime ?? 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => reportError(new Error('Audio could not be played. Check the recording file and try again.'))} /><div className="waveform" role="slider" tabIndex={0} aria-label="Seek in recording" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={position} onKeyDown={event => { if (event.key === 'ArrowRight') seek(Math.min(duration, position + 5)); if (event.key === 'ArrowLeft') seek(Math.max(0, position - 5)) }} onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); seek(Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration))) }}><svg viewBox="0 0 720 84" preserveAspectRatio="none" aria-hidden="true">{waveform ? waveform.peaks.map((peak, index) => <rect key={index} x={index * 4} y={42 - Math.max(2, peak * 38)} width="2.5" height={Math.max(4, peak * 76)} rx="1.2" fill={index / waveform.peaks.length <= position / duration ? 'var(--accent)' : 'var(--wave-muted)'} />) : <line x1="0" y1="42" x2="720" y2="42" stroke="var(--border)" />}</svg></div><div className="player-controls"><Button variant="ghost" aria-label="Back 10 seconds" onClick={() => seek(Math.max(0, position - 10))}><SkipBack size={18} /></Button><Button className="play-button" variant="primary" aria-label={playing ? 'Pause audio' : 'Play audio'} onClick={() => { void playPause() }}>{playing ? <Pause size={19} /> : <Play size={19} />}</Button><span className="player-time">{formatDuration(position)} <span>/ {formatDuration(duration)}</span></span><select aria-label="Playback speed" value={rate} onChange={event => { const value = Number(event.target.value); setRate(value); if (audio.current) audio.current.playbackRate = value }}><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><Volume2 size={17} /><input aria-label="Audio volume" type="range" min="0" max="1" step="0.05" defaultValue="1" onChange={event => { if (audio.current) audio.current.volume = Number(event.target.value) }} /></div></div> : <div className="inline-empty">Download this recording from Sync to play it here.</div>}
    <div className="recording-notes">
      <section className="recording-summary-section" aria-labelledby="summary-heading"><h2 id="summary-heading"><Sparkles size={18} />Summary</h2>
        {detail.recording.summary ? <MarkdownContent>{detail.recording.summary}</MarkdownContent> : <p className="muted recording-summary-empty">{pendingSummary ? 'Your local transcript is ready. Connect a summary provider in Settings to add a summary and action items automatically.' : detail.segments.length && retry ? 'The transcript was saved. Retry processing to finish the summary.' : active ? 'A summary will appear when processing finishes.' : 'Process this recording to create a summary.'}</p>}
        {pendingSummary && <Link to="/settings">Set up summaries</Link>}
      </section>
      <section className="recording-actions" aria-labelledby="recording-actions-heading"><h2 id="recording-actions-heading"><ListChecks size={18} />Action items</h2><ActionableList items={detail.actionables} onChanged={refresh} onSeek={seek} emptyText={detail.recording.summary ? 'No explicit action items were found.' : 'Action items will be extracted when a summary provider is connected.'} /></section>
      <section className="recording-transcript" aria-labelledby="transcript-heading"><h2 id="transcript-heading"><FileText size={18} />Transcript</h2>
      {detail.segments.length ? detail.segments.map(segment => {
        const voice = detail.speakers?.find(value => value.id === segment.speakerId)
        return <div key={segment.id} className={`transcript-segment ${position >= segment.start && position < segment.end ? 'current' : ''}`}><button className="transcript-time" aria-label={`Play from ${formatDuration(segment.start)}`} onClick={() => seek(segment.start)}><time>{formatDuration(segment.start)}</time></button><span>{voice ? <button className="speaker-label" aria-label={`Rename ${voice.label}`} onClick={() => editSpeaker(voice)}><strong>{segment.speakerName ?? voice.label}</strong><Pencil size={12} /></button> : <strong>{segment.speakerName ?? 'Speaker'}</strong>}{voice?.suggestedName && <Button className="speaker-suggestion" variant="ghost" onClick={() => { void window.electronAPI.voices.confirmSpeaker(voice.id).then(refresh).catch(reportError) }}>Possibly {voice.suggestedName}? <CheckCircle2 size={12} /></Button>}<button className="transcript-text" onClick={() => seek(segment.start)}>{segment.text}</button></span></div>
      }) : <div className="inline-empty">{active ? 'The transcript will appear here as soon as transcription finishes.' : detail.recording.status === 'empty' ? 'This recording contains silence or no usable audio.' : !detail.recording.hasAudio ? 'Download the audio first, then the app can transcribe it.' : 'Set up AI in Settings to turn this recording into a transcript, summary and action items.'}</div>}
    </section>
    </div>
    <Dialog.Root open={speaker !== null} onOpenChange={open => { if (!open && !busy) setSpeaker(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog"><div className="panel-heading"><Dialog.Title>Name this speaker</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close speaker editor" disabled={busy}><X size={17} /></Button></Dialog.Close></div><Dialog.Description>{speaker?.canRemember ? 'This name will replace the speaker label throughout this transcript, and the clean voice sample will be remembered locally.' : 'This name will replace the speaker label throughout this transcript. No clean voice sample was available to remember.'}</Dialog.Description><form className="speaker-form" onSubmit={event => { event.preventDefault(); void saveSpeaker() }}><input autoFocus aria-label="Speaker name" value={speakerName} maxLength={80} onChange={event => setSpeakerName(event.target.value)} list="remembered-voice-names" /><datalist id="remembered-voice-names">{profiles.map(profile => <option key={profile.id} value={profile.name} />)}</datalist><div className="dialog-actions"><Button type="button" disabled={busy} onClick={() => setSpeaker(null)}>Cancel</Button><Button type="submit" variant="primary" busy={busy} disabled={!speakerName.trim()}>Save speaker</Button></div></form></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>
}
