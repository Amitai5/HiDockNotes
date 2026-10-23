import { memo } from 'react'
import { ArrowUpRight, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { RecordingView } from '../shared/contracts'
import { formatDuration, formatBytes } from './ui'
import { endRecordingDrag, startRecordingDrag } from '../hooks/useRecordingDrop'
import { BrandMark } from './BrandMark'

export const RecordingList = memo(function RecordingList({ recordings }: { recordings: RecordingView[] }): JSX.Element {
  return <div className="recording-list">{recordings.map(r => <Link className="recording-row" draggable onDragStart={event => startRecordingDrag(event, r.id)} onDragEnd={endRecordingDrag} title="Drag this recording into a project folder" key={r.id} to={`/library/${r.id}${r.searchMatch ? `?t=${r.searchMatch.start}` : ''}`}>
    <div className="recording-art"><BrandMark size={32} /></div>
    <div className="recording-main"><h3>{r.title || r.filename}</h3><p>{new Date(r.recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} <span>·</span> {formatDuration(r.duration)} <span>·</span> {formatBytes(r.size)}{r.verified && r.status !== 'done' && <><span>·</span><span className="recording-saved">{r.processingMode === 'summarize' ? 'Transcript saved' : 'Downloaded'}</span></>}</p>
      {r.searchMatch && <p className="recording-search-excerpt"><span>{formatDuration(r.searchMatch.start)}</span>{r.searchMatch.excerpt}</p>}
      {r.status !== 'queued' && ['converting', 'diarizing', 'transcribing', 'identifying', 'summarizing'].includes(r.status) && r.processingMessage && <p className="recording-processing">{r.processingMessage}</p>}
    </div><span className={`status ${r.status === 'failed' ? 'status-failed' : r.status === 'queued' ? 'status-waiting' : r.verified ? 'status-verified' : ''}`}>{r.status === 'queued' ? <Clock3 size={13} /> : ['converting', 'transcribing', 'diarizing', 'identifying', 'summarizing'].includes(r.status) ? <LoaderCircle className="animate-spin" size={13} /> : r.verified ? <CheckCircle2 size={13} /> : null}{r.status === 'queued' ? `${r.processingMode === 'summarize' ? 'Summary refresh' : 'Waiting'}${r.queuePosition ? ` · #${r.queuePosition}` : ''}` : r.status === 'diarizing' ? 'Detecting speakers' : r.status === 'done' ? 'Transcribed' : r.status.replace('-', ' ')}</span><ArrowUpRight size={16} className="muted" />
  </Link>)}</div>
})
