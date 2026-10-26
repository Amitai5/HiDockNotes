import { AudioLines, FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { LibraryContentRow } from '../shared/library'
import { endRecordingDrag, startNoteDrag, startRecordingDrag } from '../hooks/useRecordingDrop'
import { noteUrl, recordingUrl } from '../services/note-url'
import { formatDuration } from './ui'

export function LibraryContentList({ items, selected }: { items: LibraryContentRow[]; selected?: { id: string; kind: 'note' | 'recording' } }): JSX.Element {
  return <div className="library-content-list">{items.map(item => <Link key={`${item.kind}:${item.id}`} className={`library-content-row ${item.kind === selected?.kind && item.id === selected.id ? 'selected' : ''}`} to={item.kind === 'note' ? noteUrl(item.id, item.projectId) : recordingUrl(item.id, item.projectId)} draggable onDragStart={event => item.kind === 'note' ? startNoteDrag(event, item.id, item.revision) : startRecordingDrag(event, item.id)} onDragEnd={endRecordingDrag} title={item.title} aria-current={item.kind === selected?.kind && item.id === selected.id ? 'page' : undefined}>
    <span className={`content-kind-icon ${item.kind}`}>{item.kind === 'note' ? <FileText size={21} /> : <AudioLines size={21} />}</span><span className="library-content-row-text"><strong>{item.title || 'Untitled'}</strong><small>{item.kind === 'note' ? item.preview || 'Start writing…' : item.preview || 'Audio recording'}</small><span className="content-row-meta"><span>{item.kind === 'note' ? 'Note' : formatDuration(item.recording.duration)}</span><time dateTime={item.kind === 'note' ? item.updatedAt : item.recording.recordedAt}>{new Date(item.kind === 'note' ? item.updatedAt : item.recording.recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>{item.kind === 'recording' && <span>{item.recording.status === 'done' ? 'Transcribed' : item.recording.status.replaceAll('-', ' ')}</span>}</span></span>
  </Link>)}</div>
}
