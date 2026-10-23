import { appClient } from '../services/app-client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Clock3, FileText, LoaderCircle, Pause, Play, X } from 'lucide-react'
import type { RecordingCitation } from '../shared/ai'
import type { RecordingDetail } from '../shared/contracts'
import { Button, formatDuration } from './ui'
import { MarkdownContent } from './MarkdownContent'
import { speakerColors } from './SpeakerEditor'
import { useRecordingPlayback } from '../hooks/useRecordingPlayback'

export function AssistantSourcePanel({ citation, onClose }: { citation: RecordingCitation; onClose(): void }): JSX.Element {
  const [detail, setDetail] = useState<RecordingDetail | null>(null)
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0)
  const [tab, setTab] = useState<'transcript' | 'summary'>('transcript')
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const tabs = useRef<HTMLDivElement>(null)
  const { audio, position, playing, loading, seek, playPause } = useRecordingPlayback(citation.recordingId, !!detail?.recording.hasAudio, citation.start)
  useEffect(() => {
    let mounted = true, revision = 0
    const load = (): void => {
      const request = ++revision
      void appClient.library.detail(citation.recordingId).then(value => {
        if (!mounted || request !== revision) return
        setDetail(value); setError(null)
        const found = value.segments.findIndex(segment => segment.end > citation.start)
        const anchor = found < 0 ? Math.max(0, value.segments.length - 1) : found
        setRange(previous => previous ?? { start: anchor, end: Math.min(value.segments.length, anchor + 20) })
      }).catch(() => { if (mounted && request === revision) setError('This recording could not be loaded. It may have been moved or deleted. The cited passage is still available above.') })
    }
    load()
    const unsubscribe = appClient.library.onChanged(load)
    return () => { mounted = false; unsubscribe() }
  }, [citation.recordingId, citation.start, retry])
  const colors = useMemo(() => speakerColors(detail?.segments.map(segment => segment.speakerName ?? 'Unknown speaker') ?? []), [detail?.segments])
  const duration = detail?.recording.duration ?? 0
  const visible = range && detail ? detail.segments.slice(range.start, range.end) : []
  const citedId = detail?.segments.find(segment => segment.end > citation.start)?.id ?? detail?.segments.at(-1)?.id
  return <aside className="assistant-source-panel" aria-label="Recording source">
    <header className="source-panel-heading"><div><small>Source [{citation.number}]</small><h2>{detail?.recording.title || citation.title}</h2></div><Button variant="ghost" aria-label="Close source panel" title="Close source panel" onClick={onClose}><X size={18} /></Button></header>
    <div className="source-panel-scroll">
      <section className="source-cited-passage" aria-label="Cited passage"><small><Clock3 size={13} />{formatDuration(citation.start)} · Cited passage</small><p>{citation.excerpt}</p></section>
      {error ? <div className="source-load-error" role="alert"><p>{error}</p><Button onClick={() => { setError(null); setRetry(value => value + 1) }}>Try again</Button></div> : !detail ? <div className="source-loading" role="status"><LoaderCircle className="animate-spin" size={16} />Loading recording…</div> : null}
      {detail && <>
        <p className="source-recorded-at"><time dateTime={detail.recording.recordedAt}>{new Date(detail.recording.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time> · {formatDuration(duration)}</p>
        {detail.recording.hasAudio && <div className="source-audio-player"><audio ref={audio} src={`/api/v1/recordings/${citation.recordingId}/audio`} preload="metadata" /><div><Button className="source-play" variant="primary" aria-label={loading ? 'Cancel source playback' : playing ? 'Pause source audio' : 'Play source audio'} onClick={() => { void playPause() }}>{loading ? <LoaderCircle className="animate-spin" size={17} /> : playing ? <Pause size={17} /> : <Play size={17} />}</Button><span>{formatDuration(position)} <small>/ {formatDuration(duration)}</small></span></div><input type="range" aria-label="Seek source recording" min={0} max={duration} step={0.1} value={Math.min(position, duration)} onChange={event => seek(Number(event.target.value))} /></div>}
        <div className="source-tabs" role="tablist" aria-label="Recording source content" ref={tabs}>{(['transcript', 'summary'] as const).map((value, index) => <button key={value} id={`source-tab-${value}`} role="tab" aria-selected={tab === value} aria-controls={`source-${value}`} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index; setTab(next ? 'summary' : 'transcript'); (tabs.current?.children[next] as HTMLButtonElement | undefined)?.focus() } }}>{value === 'transcript' ? 'Transcript' : 'Summary'}</button>)}</div>
        <div role="tabpanel" id="source-transcript" aria-labelledby="source-tab-transcript" hidden={tab !== 'transcript'}>
          {tab === 'transcript' && <>{range && range.start > 0 && <Button className="source-more" variant="ghost" onClick={() => setRange(value => value && { ...value, start: Math.max(0, value.start - 40) })}>Show earlier transcript</Button>}
          {visible.length ? visible.map(segment => <div key={segment.id} className={`source-transcript-line${segment.id === citedId ? ' cited' : ''}${position >= segment.start && position < segment.end ? ' current' : ''}`}><div><button disabled={!detail.recording.hasAudio} onClick={() => seek(segment.start)} aria-label={`Play source from ${formatDuration(segment.start)}`}>{formatDuration(segment.start)}</button><strong className={`source-speaker ${colors.get((segment.speakerName ?? 'Unknown speaker').trim().toLowerCase()) ?? 'speaker-unknown'}`}>{segment.speakerName ?? 'Unknown speaker'}</strong></div><p>{segment.text}</p></div>) : <p className="source-empty"><FileText size={16} />No transcript is available for this recording yet.</p>}
          {range && range.end < detail.segments.length && <Button className="source-more" variant="ghost" onClick={() => setRange(value => value && { ...value, end: Math.min(detail.segments.length, value.end + 40) })}>Show later transcript</Button>}</>}
        </div>
        <div role="tabpanel" id="source-summary" aria-labelledby="source-tab-summary" hidden={tab !== 'summary'}>{tab === 'summary' && (detail.recording.summary ? <MarkdownContent hideActionItems>{detail.recording.summary}</MarkdownContent> : <p className="source-empty">No summary is available for this recording yet.</p>)}</div>
      </>}
    </div>
  </aside>
}
