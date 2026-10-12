import { useState } from 'react'
import { ArrowLeft, ChevronRight, FileAudio2, Folder, FolderOpen, Plus, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, EmptyState } from '../components/ui'
import { RecordingList } from '../components/RecordingList'
import { ProcessingQueue } from '../components/ProcessingQueue'
import { CreateProjectFolder } from '../components/CreateProjectFolder'
import { useRecordings } from '../hooks/useRecordings'
import { useLibraryNavigation } from '../hooks/useLibraryNavigation'
import { useAppStore, reportError } from '../store/useAppStore'

export function LibraryPage(): JSX.Element {
  const search = useAppStore(s => s.search)
  const [status, setStatus] = useState('')
  const [params] = useSearchParams()
  const { projects } = useLibraryNavigation()
  const { recordings, loading } = useRecordings(search, status)
  const [importing, setImporting] = useState(false)
  const [from, setFrom] = useState('')
  const projectId = params.get('project')
  const project = projects.find(value => value.id === projectId)
  const unfiled = params.get('scope') === 'unfiled'
  const root = !projectId && !unfiled
  const searching = !!search.trim()
  const filtered = recordings.filter(recording => (!projectId || recording.projectId === projectId) && (!unfiled || !recording.projectId) && (!from || recording.recordedAt.slice(0, 10) >= from))
  const visible = root && !searching ? filtered.filter(recording => !recording.projectId) : filtered
  const title = projectId ? project?.name ?? 'Project folder' : unfiled ? 'Unfiled recordings' : 'Library'
  return <div className="page library-page">
    {!root && <Link className="back-link" to="/library"><ArrowLeft size={14} />Library</Link>}
    <div className="page-heading"><div><h1>{title}</h1><p>{projectId ? 'All recordings in this project.' : unfiled ? 'Recordings waiting for a home.' : 'Your projects and recordings, in one place.'}</p></div><div className="toolbar-actions"><CreateProjectFolder /><Button variant="primary" busy={importing} onClick={() => { setImporting(true); void window.electronAPI.library.importAudio().catch(reportError).finally(() => setImporting(false)) }}><Plus size={16} />Import audio</Button></div></div>
    <ProcessingQueue />
    <div className="library-toolbar"><span className="muted">{filtered.length} recording{filtered.length === 1 ? '' : 's'}{root && !searching && ` · ${projects.length} project folder${projects.length === 1 ? '' : 's'}`}</span><div className="toolbar-actions"><label className="filter-label">From <input type="date" aria-label="Recordings from date" value={from} onChange={event => setFrom(event.target.value)} /></label><select aria-label="Filter by recording status" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option><option value="device-only">On device</option><option value="downloaded">Downloaded</option><option value="queued">Waiting for transcription</option><option value="diarizing">Detecting speakers</option><option value="transcribing">Transcribing</option><option value="done">Transcribed</option><option value="failed">Failed</option></select><Button variant="ghost" onClick={() => { void window.electronAPI.app.openRecordingsFolder().catch(reportError) }}><FolderOpen size={16} />Open audio folder</Button></div></div>
    {root && !searching && projects.length > 0 && <section className="library-projects" aria-label="Project folders"><h2>Project folders</h2><div className="folder-grid">{projects.map(folder => {
      const count = status || from ? filtered.filter(recording => recording.projectId === folder.id).length : folder.count
      return <Link className="folder-card" key={folder.id} to={`/library?project=${encodeURIComponent(folder.id)}`}><div className="folder-art"><Folder size={24} /></div><div><h3>{folder.name}</h3><p>{count} recording{count === 1 ? '' : 's'}{status || from ? ' matching filters' : ''}</p></div><ChevronRight size={16} /></Link>
    })}</div></section>}
    {root && !searching && <div className="library-section-heading"><h2>Unfiled recordings</h2><span className="muted">{visible.length}</span></div>}
    {searching && <div className="library-section-heading"><h2>Search results</h2><span className="muted">{root ? 'Across all folders and unfiled recordings' : `In ${title}`}</span></div>}
    {visible.length ? <RecordingList recordings={visible} /> : <EmptyState icon={searching ? <Search size={30} /> : <FileAudio2 size={30} />} title={loading ? 'Loading recordings…' : searching || status || from ? 'No matching recordings' : root && projects.length ? 'Everything has a home' : projectId ? 'This folder is ready' : 'Your library starts here'}>{searching || status || from ? 'Try changing your search or filters.' : projectId ? 'Assign recordings to this folder from their detail view.' : root && projects.length ? 'Open a project folder to view its recordings, or import something new.' : 'Download from your recorder or import an audio file to start.'}</EmptyState>}
  </div>
}
