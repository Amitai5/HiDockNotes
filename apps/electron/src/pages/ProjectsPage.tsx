import { useEffect, useState } from 'react'
import { Folder, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, EmptyState } from '../components/ui'
import type { ProjectView } from '../shared/contracts'
import { reportError } from '../store/useAppStore'

export function ProjectsPage(): JSX.Element {
  const [projects, setProjects] = useState<ProjectView[]>([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  useEffect(() => { void window.electronAPI.projects.list().then(setProjects).catch(reportError) }, [])
  function create(): void { setCreating(true); void window.electronAPI.projects.create(name).then(p => { setProjects(prev => [...prev, p]); setName('') }).catch(reportError).finally(() => setCreating(false)) }
  return <div className="page"><div className="page-heading"><div><h1>Projects</h1><p>Keep related recordings together.</p></div></div><form className="project-create" onSubmit={e => { e.preventDefault(); if (name.trim()) create() }}><input aria-label="New project name" placeholder="New project name" value={name} onChange={e => setName(e.target.value)} maxLength={80} /><Button type="submit" variant="primary" busy={creating} disabled={!name.trim()}><Plus size={15} />Create project</Button></form>{projects.length ? <div className="project-list">{projects.map(p => <Link to={`/library?project=${p.id}`} className="project-row" key={p.id}><Folder size={23} /><div><h3>{p.name}</h3><p>{p.count} recording{p.count === 1 ? '' : 's'}</p></div></Link>)}</div> : <EmptyState icon={<Folder size={30} />} title="A little organization goes a long way">Create a project, then assign recordings from their detail view.</EmptyState>}</div>
}
