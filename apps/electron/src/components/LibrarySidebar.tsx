import { useState } from 'react'
import { BookOpen, ChevronDown, FileAudio2, Folder, FolderOpen } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useLibraryNavigation } from '../hooks/useLibraryNavigation'

export function LibrarySidebar(): JSX.Element {
  const { projects, looseRecordings } = useLibraryNavigation()
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
      {projects.map(project => <Link key={project.id} className={`library-tree-item ${inLibrary && query.get('project') === project.id ? 'active' : ''}`} to={`/library?project=${encodeURIComponent(project.id)}`} title={project.name}><Folder size={15} /><span>{project.name}</span><small>{project.count}</small></Link>)}
      <Link className={`library-tree-item unfiled-heading ${inLibrary && query.get('scope') === 'unfiled' ? 'active' : ''}`} to="/library?scope=unfiled"><FolderOpen size={15} /><span>Unfiled recordings</span><small>{looseRecordings.length}</small></Link>
      {looseRecordings.map(recording => <Link key={recording.id} className={`library-tree-item library-recording-link ${location.pathname === `/library/${recording.id}` ? 'active' : ''}`} to={`/library/${recording.id}`} title={recording.title || recording.filename}><FileAudio2 size={13} /><span>{recording.title || recording.filename}</span></Link>)}
    </div>}
  </div>
}
