import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useId, useRef, useState } from 'react'
import { Folder, Inbox, X } from 'lucide-react'
import type { ProjectView, RecordingView } from '../shared/contracts'
import { appClient } from '../services/app-client'
import { Button } from './ui'

export function RecordingMove({ recording, open, onOpenChange, onMoved, onClosed }: { recording: RecordingView; open: boolean; onOpenChange(value: boolean): void; onMoved?(projectId: string | null, name: string): void; onClosed?(): void }): JSX.Element {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [destination, setDestination] = useState<string | null>(recording.projectId)
  const [filter, setFilter] = useState(''), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null), alive = useRef(false), moving = useRef(false)
  const name = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    if (!open) return
    let current = true
    setLoading(true); setError(''); setFilter(''); setDestination(recording.projectId)
    void appClient.projects.list().then(value => { if (current) setProjects(value) }).catch(value => { if (current) setError(value instanceof Error ? value.message : 'Projects could not be loaded.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [open, recording.id, recording.projectId, attempt])
  async function move(): Promise<void> {
    if (moving.current || loading || destination === recording.projectId) return
    moving.current = true; setBusy(true); setError('')
    try {
      await appClient.projects.assign(recording.id, destination)
      if (alive.current) { onMoved?.(destination, projects.find(project => project.id === destination)?.name ?? 'Unfiled items'); onOpenChange(false) }
    } catch (value) { if (alive.current) setError(value instanceof Error ? value.message : 'The recording could not be moved. Try again.') }
    finally { moving.current = false; if (alive.current) setBusy(false) }
  }
  const choices = [{ id: null, name: 'Unfiled items' }, ...projects].filter(project => project.name.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  return <Dialog.Root open={open} onOpenChange={value => { if (!moving.current) onOpenChange(value) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog recording-move-dialog" onOpenAutoFocus={event => { event.preventDefault(); heading.current?.focus() }} onCloseAutoFocus={event => { if (onClosed) { event.preventDefault(); onClosed() } }}>
    <div className="panel-heading"><Dialog.Title ref={heading} tabIndex={-1}>Move recording</Dialog.Title><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label="Close move recording"><X size={18} /></Button></Dialog.Close></div>
    <Dialog.Description>Choose a project for <strong>{recording.title || recording.filename}</strong>. Its audio, transcript and summary stay together.</Dialog.Description>
    <label className="move-project-filter">Find a project<input aria-label="Find a project" value={filter} onChange={event => setFilter(event.target.value)} disabled={busy || loading} placeholder="Search projects" /></label>
    {loading ? <p role="status">Loading projects…</p> : <fieldset className="move-project-choices" disabled={busy}><legend className="sr-only">Destination project</legend>{choices.map(project => <label key={project.id ?? '__unfiled'} className={destination === project.id ? 'selected' : ''}><input type="radio" aria-label={project.name} name={name} value={project.id ?? ''} checked={destination === project.id} onChange={() => setDestination(project.id)} />{project.id ? <Folder size={18} /> : <Inbox size={18} />}<span>{project.name}</span>{project.id === recording.projectId && <small>Current</small>}</label>)}{!choices.length && <p>No matching projects.</p>}</fieldset>}
    {error && <div className="provider-error" role="alert"><p>{error}</p>{!projects.length && <Button onClick={() => setAttempt(value => value + 1)} disabled={busy}>Reload projects</Button>}</div>}
    <div className="dialog-actions"><Dialog.Close asChild><Button disabled={busy}>Cancel</Button></Dialog.Close><Button variant="primary" busy={busy} disabled={loading || destination === recording.projectId} onClick={() => { void move() }}>Move recording</Button></div>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
}
