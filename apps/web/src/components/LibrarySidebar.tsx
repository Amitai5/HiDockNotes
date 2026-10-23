import { useState } from 'react'
import { BookOpen, ChevronDown, FileAudio2, Folder, Inbox } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useLibraryNavigation } from '../hooks/useLibraryNavigation'
import { endRecordingDrag, startRecordingDrag } from '../hooks/useRecordingDrop'
import type { RecordingView } from '../shared/contracts'
import { RecordingDropLink } from './RecordingDropLink'

function LibraryFolder({ id, name, count, recordings, active }: { id: string | null; name: string; count: number; recordings: Pick<RecordingView, 'id' | 'title' | 'filename'>[]; active: boolean }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const location = useLocation()
  const controls = `library-folder-${id ?? 'unfiled'}`
  return <div className={`library-folder${id === null ? ' library-unfiled-folder' : ''}`}>
    <div className={`library-folder-heading ${active ? 'active' : ''}`}>
      <RecordingDropLink projectId={id} to={id ? `/library?project=${encodeURIComponent(id)}` : '/library?scope=unfiled'} className="library-tree-item" title={name} aria-label={`${name}, ${count} recordings`}>{id ? <Folder size={15} /> : <Inbox size={16} />}<span>{id ? name : 'Unfiled'}</span><small>{count}</small></RecordingDropLink>
      <button className="folder-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`} aria-expanded={expanded} aria-controls={controls} onClick={() => setExpanded(value => !value)}><ChevronDown size={13} className={expanded ? '' : 'collapsed'} /></button>
    </div>
    {expanded && <div id={controls} className="library-folder-recordings">{recordings.length ? recordings.map(recording => <Link key={recording.id} draggable onDragStart={event => startRecordingDrag(event, recording.id)} onDragEnd={endRecordingDrag} className={`library-tree-item library-recording-link ${location.pathname === `/library/${recording.id}` ? 'active' : ''}`} to={`/library/${recording.id}`} title={recording.title || recording.filename}><FileAudio2 size={13} /><span>{recording.title || recording.filename}</span></Link>) : <small className="folder-empty">No recordings</small>}</div>}
  </div>
}

export function LibrarySidebar(): JSX.Element {
  const { projects, looseRecordings, projectRecordings } = useLibraryNavigation()
  const [expanded, setExpanded] = useState(true)
  const location = useLocation()
  const query = new URLSearchParams(location.search)
  const inLibrary = location.pathname.startsWith('/library')
  return <div className="library-sidebar">
    <div className={`nav-item library-nav-heading ${inLibrary ? 'active' : ''}`}>
      <Link to="/library"><BookOpen size={18} strokeWidth={1.7} /><span>Library</span></Link>
      <button aria-label={expanded ? 'Collapse library folders' : 'Expand library folders'} aria-expanded={expanded} aria-controls="library-folders" onClick={() => setExpanded(value => !value)}><ChevronDown size={14} className={expanded ? '' : 'collapsed'} /></button>
    </div>
    {expanded && <div id="library-folders" className="library-tree">
      {projects.map(project => <LibraryFolder key={project.id} id={project.id} name={project.name} count={project.count} recordings={projectRecordings?.[project.id] ?? []} active={inLibrary && query.get('project') === project.id} />)}
      <LibraryFolder id={null} name="Unfiled recordings" count={looseRecordings.length} recordings={looseRecordings} active={inLibrary && query.get('scope') === 'unfiled'} />
    </div>}
  </div>
}
