import { appClient } from '../services/app-client'
import { useEffect, useState } from 'react'
import type { ActionableView } from '../shared/contracts'
import { reportError } from '../store/useAppStore'
import { ActionableList } from '../components/ActionableList'
import { ArrowRight, AudioLines, FileAudio2, ListChecks, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'
import { useRecordings } from '../hooks/useRecordings'
import { RecordingList } from '../components/RecordingList'
import { EmptyState } from '../components/ui'

export function TodayPage(): JSX.Element {
  const name = useAppStore(s => s.settings?.name)
  const [dismissed, setDismissed] = useState(false)
  const { recordings } = useRecordings()
  const [actions, setActions] = useState<ActionableView[]>([])
  useEffect(() => { const load = () => { void appClient.actionables.list().then(setActions).catch(reportError) }; load(); return appClient.library.onChanged(load) }, [])
  const date = new Date()
  const today = recordings.filter(r => new Date(r.recordedAt).toDateString() === date.toDateString())
  const todayIds = new Set(today.map(recording => recording.id))
  const todayActions = actions.filter(item => !item.done && todayIds.has(item.recordingId))
  const greeting = date.getHours() < 12 ? 'Good morning' : date.getHours() < 18 ? 'Good afternoon' : 'Good evening'
  return <div className="page"><div className="page-heading"><div><h1>{greeting}{name ? `, ${name}` : ''}</h1><p>{date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p></div><Link className="button button-secondary" to="/sync"><AudioLines size={16} />Sync recorder</Link></div>{!name && !dismissed && <div className="name-prompt"><span>Make this space yours. <Link to="/settings">Add your name in Settings</Link></span><button aria-label="Dismiss name prompt" onClick={() => setDismissed(true)}><X size={15} /></button></div>}<div className="section-heading"><h2>Today's recordings</h2><span className="muted">{today.length}</span></div>{today.length ? <RecordingList recordings={today} /> : <EmptyState icon={<FileAudio2 size={28} />} title="A fresh start">Your recordings from today will appear here.</EmptyState>}<div className="section-heading mt-10"><h2>Recent recordings</h2><Link to="/library">View library <ArrowRight size={14} /></Link></div>{recordings.length ? <RecordingList recordings={recordings.slice(0, 5)} /> : <div className="inline-empty">Your saved recordings will be here when you need them.</div>}<div className="section-heading mt-10"><h2><ListChecks size={18} />Today's action items</h2><Link to="/actionables">View all <ArrowRight size={14} /></Link></div><ActionableList items={todayActions} onChanged={() => { void appClient.actionables.list().then(setActions).catch(reportError) }} emptyText="No action items for today yet. They will appear after your recordings are summarized." /></div>
}
