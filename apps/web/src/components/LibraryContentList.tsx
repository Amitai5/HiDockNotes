import { FileAudio2, FileText } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { LibraryContentRow } from '../shared/library'
import { endRecordingDrag, startNoteDrag, startRecordingDrag } from '../hooks/useRecordingDrop'
import { noteUrl } from '../services/note-url'
import { formatDuration } from './ui'

export function LibraryContentList({ items, selected }: { items: LibraryContentRow[]; selected?: string }): JSX.Element {
  return <div className="library-content-list">{items.map(item => <Link key={`${item.kind}:${item.id}`} className={`library-content-row ${item.kind === 'note' && item.id === selected ? 'selected' : ''}`} to={item.kind === 'note' ? noteUrl(item.id, item.projectId) : `/library/${item.id}`} draggable onDragStart={event => item.kind === 'note' ? startNoteDrag(event, item.id, item.revision) : startRecordingDrag(event, item.id)} onDragEnd={endRecordingDrag} title={item.title} aria-current={item.kind === 'note' && item.id === selected ? 'page' : undefined}>
    <span className={`content-kind-icon ${item.kind}`}>{item.kind === 'note' ? <FileText size={18} /> : <FileAudio2 size={18} />}</span><span className="library-content-row-text"><strong>{item.title || 'Untitled'}</strong><small>{item.kind === 'note' ? item.preview || 'Start writing…' : item.preview || 'Audio recording'}</small><span className="content-row-meta"><span>{item.kind === 'note' ? 'Note' : formatDuration(item.recording.duration)}</span><time dateTime={item.kind === 'note' ? item.updatedAt : item.recording.recordedAt}>{new Date(item.kind === 'note' ? item.updatedAt : item.recording.recordedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>{item.kind === 'recording' && <span>{item.recording.status === 'done' ? 'Transcribed' : item.recording.status.replaceAll('-', ' ')}</span>}</span></span>
  </Link>)}</div>
}
