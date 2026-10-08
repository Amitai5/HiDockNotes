import * as Dialog from '@radix-ui/react-dialog'
import { Activity, CheckCircle2, Trash2, X } from 'lucide-react'
import { useAppStore, reportError } from '../store/useAppStore'
import { clearActivity } from '../hooks/useDeviceSubscriptions'
import { Button } from './ui'

export function ActivityLog(): JSX.Element {
  const open = useAppStore(s => s.activityOpen)
  const entries = useAppStore(s => s.activity)
  const setOpen = useAppStore(s => s.setActivityOpen)
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="activity-panel" aria-describedby="activity-description">
      <div className="panel-heading"><div><Dialog.Title><Activity size={20} /> Activity log</Dialog.Title><Dialog.Description id="activity-description">Device operations and application events.</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" aria-label="Close activity log"><X size={18} /></Button></Dialog.Close></div>
      <div className="activity-list">{entries.length === 0 ? <div className="activity-empty"><CheckCircle2 size={28} /><p>All clear</p><span>New activity will appear here.</span></div> : [...entries].reverse().map(entry => <div className={`activity-row activity-${entry.type}`} key={entry.id}><span className="activity-dot" /><div><p>{entry.message}</p>{entry.details && <small>{entry.details}</small>}<time>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div></div>)}</div>
      <div className="panel-footer"><span>{entries.length} event{entries.length === 1 ? '' : 's'}</span><Button disabled={entries.length === 0} onClick={() => { void clearActivity().catch(reportError) }}><Trash2 size={14} />Clear log</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
