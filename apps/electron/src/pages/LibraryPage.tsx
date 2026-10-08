import { useState } from 'react'
import { FileAudio2, FolderOpen, Plus, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { Button, EmptyState } from '../components/ui'
import { RecordingList } from '../components/RecordingList'
import { ProcessingQueue } from '../components/ProcessingQueue'
import { useRecordings } from '../hooks/useRecordings'
import { useAppStore, reportError } from '../store/useAppStore'

export function LibraryPage(): JSX.Element {
  const search = useAppStore(s => s.search)
  const [status, setStatus] = useState('')
  const [params] = useSearchParams()
  const { recordings, loading } = useRecordings(search, status)
  const [importing, setImporting] = useState(false)
  const [from, setFrom] = useState('')
  const project = params.get('project')
  const filtered = recordings.filter(r => (!project || r.projectId === project) && (!from || r.recordedAt.slice(0, 10) >= from))
  return <div className="page"><div className="page-heading"><div><h1>Library</h1><p>A home for every recording.</p></div><Button variant="primary" busy={importing} onClick={() => { setImporting(true); void window.electronAPI.library.importAudio().catch(reportError).finally(() => setImporting(false)) }}><Plus size={16} />Import audio</Button></div><ProcessingQueue /><div className="library-toolbar"><span className="muted">{filtered.length} recording{filtered.length === 1 ? '' : 's'}</span><div className="toolbar-actions"><label className="filter-label">From <input type="date" aria-label="Recordings from date" value={from} onChange={e => setFrom(e.target.value)} /></label><select aria-label="Filter by recording status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option value="device-only">On device</option><option value="downloaded">Downloaded</option><option value="queued">Waiting for transcription</option><option value="diarizing">Detecting speakers</option><option value="transcribing">Transcribing</option><option value="done">Transcribed</option><option value="failed">Failed</option></select><Button variant="ghost" onClick={() => { void window.electronAPI.app.openRecordingsFolder().catch(reportError) }}><FolderOpen size={16} />Open folder</Button></div></div>{filtered.length ? <RecordingList recordings={filtered} /> : <EmptyState icon={search ? <Search size={30} /> : <FileAudio2 size={30} />} title={loading ? 'Loading recordings…' : search || status || from || project ? 'No matching recordings' : 'Your library starts here'}>{search || status || from || project ? 'Try changing your search or filters.' : 'Download from your recorder or import an audio file to start.'}</EmptyState>}</div>
}
