import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useRef, useState } from 'react'
import { FileAudio2, Upload, X } from 'lucide-react'
import { useLibraryNavigation } from '../hooks/useLibraryNavigation'
import { uploadAudio } from '../services/upload'
import { Button } from './ui'

interface AudioTask { file: File; requestId: string; projectId: string | null; state: 'waiting' | 'uploading' | 'verifying' | 'done' | 'failed' | 'cancelled'; progress: number; error?: string }
export function AudioImportDialog({ projectId, projectName, dropped, onDropHandled }: { projectId: string | null; projectName: string; dropped?: File[]; onDropHandled?(): void }): JSX.Element {
  const { projects } = useLibraryNavigation()
  const [open, setOpen] = useState(false), [destination, setDestination] = useState<string | null>(projectId), [tasks, setTasks] = useState<AudioTask[]>([]), [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null), pending = useRef(false), mounted = useRef(true)
  const destinationName = projects.find(project => project.id === destination)?.name ?? (destination ? projectName : 'Unfiled items')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort() } }, [])
  const update = (id: string, patch: Partial<AudioTask>): void => { if (mounted.current) setTasks(current => current.map(task => task.requestId === id ? { ...task, ...patch } : task)) }
  async function run(batch: AudioTask[]): Promise<void> {
    if (pending.current || !batch.length) return
    pending.current = true; setBusy(true); const abort = new AbortController(); controller.current = abort
    try {
      for (const task of batch) {
        if (abort.signal.aborted) { update(task.requestId, { state: 'cancelled' }); continue }
        update(task.requestId, { state: 'uploading', error: '' })
        try {
          await uploadAudio(task.file, { filename: task.file.name, recordedAt: new Date(task.file.lastModified).toISOString(), projectId: task.projectId, requestId: task.requestId }, offset => update(task.requestId, { progress: Math.round(offset / task.file.size * 100) }), abort.signal, () => update(task.requestId, { state: 'verifying' }))
          update(task.requestId, { state: 'done', progress: 100 })
        } catch (error) { update(task.requestId, { state: abort.signal.aborted ? 'cancelled' : 'failed', error: error instanceof Error ? error.message : 'The audio could not be imported.' }) }
      }
    } finally { pending.current = false; controller.current = null; if (mounted.current) setBusy(false) }
  }
  function add(files: File[], target: string | null): void {
    const batch = files.map(file => ({ file, projectId: target, requestId: crypto.randomUUID(), state: 'waiting' as const, progress: 0 }))
    setTasks(batch); void run(batch)
  }
  useEffect(() => { if (dropped?.length) { setDestination(projectId); setOpen(true); add(dropped, projectId); onDropHandled?.() } }, [dropped]) // Destination is captured with the dropped file batch.
  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); if (value) { setDestination(projectId); setTasks([]) } } }}><Dialog.Trigger asChild><Button><FileAudio2 size={16} />New note from audio</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog audio-import-dialog"><div className="panel-heading"><Dialog.Title>New note from audio</Dialog.Title><Dialog.Close asChild><Button variant="ghost" aria-label="Close audio import" disabled={busy}><X size={18} /></Button></Dialog.Close></div><Dialog.Description>Copy audio to the server, then process it using its project’s context. A transcript appears when processing finishes.</Dialog.Description><label className="note-field">Destination<select aria-label="Audio destination" value={destination ?? ''} disabled={busy || tasks.some(task => task.state === 'done')} onChange={event => { setDestination(event.target.value || null); setTasks([]) }}><option value="">Unfiled items</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><p className="muted">These files stay in <strong>{destinationName}</strong> if you open a different project.</p><input ref={input} type="file" hidden accept="audio/*,.hda,.m4a,.flac" multiple onChange={event => { const files = [...event.target.files ?? []]; event.target.value = ''; if (files.length) add(files, destination) }} /><div className="audio-import-drop" onDragOver={event => { if (!busy && event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={event => { event.preventDefault(); if (!busy) add([...event.dataTransfer.files], destination) }}><Upload size={24} /><p>Drop audio files here</p><Button variant="primary" disabled={busy} onClick={() => input.current?.click()}>Choose audio files</Button></div>{tasks.length > 0 && <ul className="audio-import-tasks" aria-live="polite">{tasks.map(task => <li key={task.requestId}><strong>{task.file.name}</strong><span>{task.state === 'uploading' ? `Uploading ${task.progress}%` : task.state === 'verifying' ? 'Verifying server copy…' : task.state === 'done' ? 'Saved to server · queued for processing' : task.state === 'failed' ? task.error : task.state === 'cancelled' ? 'Import cancelled' : 'Waiting'}</span></li>)}</ul>}<div className="dialog-actions">{busy ? <Button onClick={() => controller.current?.abort()}>Cancel remaining imports</Button> : <>{tasks.some(task => ['failed', 'cancelled'].includes(task.state)) && <Button onClick={() => { void run(tasks.filter(task => ['failed', 'cancelled'].includes(task.state))) }}>Retry incomplete files</Button>}<Dialog.Close asChild><Button>Done</Button></Dialog.Close></>}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
}
