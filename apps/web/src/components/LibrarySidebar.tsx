import { BookOpen, Folder, Inbox } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useLibraryNavigation } from '../hooks/useLibraryNavigation'
import { RecordingDropLink } from './RecordingDropLink'
import { CreateProjectFolder } from './CreateProjectFolder'

export function LibrarySidebar(): JSX.Element {
  const { projects, looseRecordings, projectRecordings } = useLibraryNavigation()
  const location = useLocation(), query = new URLSearchParams(location.search)
  const recordingId = location.pathname.match(/^\/library\/([^/]+)$/)?.[1]
  const library = location.pathname === '/library', note = location.pathname.startsWith('/notes/')
  const projectId = query.get('project') ?? (recordingId ? projects.find(project => projectRecordings?.[project.id]?.some(value => value.id === recordingId))?.id : null)
  const unfiled = (library || note) && query.get('scope') === 'unfiled' || !!recordingId && looseRecordings.some(value => value.id === recordingId)
  return <div className="library-sidebar library-flat">
    <Link to="/library" className={`nav-item ${library && !projectId && !unfiled ? 'active' : ''}`} aria-current={library && !projectId && !unfiled ? 'page' : undefined}><BookOpen size={18} strokeWidth={1.7} /><span>Library</span></Link>
    <div className="library-project-label"><span>Projects</span><CreateProjectFolder compact /></div>
    <div className="library-flat-projects">{projects.map(project => <RecordingDropLink projectId={project.id} key={project.id} to={`/library?project=${encodeURIComponent(project.id)}`} className={`nav-item library-project-link ${projectId === project.id ? 'active' : ''}`} title={project.name} aria-label={project.name} aria-current={projectId === project.id ? 'page' : undefined}><Folder size={16} /><span>{project.name}</span></RecordingDropLink>)}</div>
    <RecordingDropLink projectId={null} to="/library?scope=unfiled" className={`nav-item library-project-link ${unfiled ? 'active' : ''}`} title="Unfiled items" aria-current={unfiled ? 'page' : undefined}><Inbox size={17} /><span>Unfiled items</span></RecordingDropLink>
  </div>
}
