import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { Activity, CheckCircle2, Trash2, X } from 'lucide-react'
import { useAppStore, reportError } from '../store/useAppStore'
import { clearActivity } from '../hooks/useDeviceSubscriptions'
import { Button } from './ui'
import type { PipelineState } from '../shared/device-pipeline'
import { ProcessingQueue } from './ProcessingQueue'

export function ActivityLog(): JSX.Element {
  const open = useAppStore(s => s.activityOpen)
  const entries = useAppStore(s => s.activity)
  const setOpen = useAppStore(s => s.setActivityOpen)
  const [device, setDevice] = useState<PipelineState | null>(null)
  useEffect(() => {
    if (!open) return
    let mounted = true, updated = false
    const removeDevice = appClient.devicePipeline.onState(value => { updated = true; if (mounted) setDevice(value) })
    void appClient.devicePipeline.getState().then(value => { if (mounted && !updated) setDevice(value) }).catch(reportError)
    return () => { mounted = false; removeDevice() }
  }, [open])
  const deviceLabels = { disconnected: 'Recorder disconnected', connecting: 'Connecting to recorder', initializing: 'Reading recorder information', scanning: 'Reading recorder file list', reconciling: 'Checking downloaded recordings', downloading: 'Downloading recordings', idle: 'Recorder ready', error: 'Recorder needs attention' }
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="activity-panel" aria-describedby="activity-description">
      <div className="panel-heading"><div><Dialog.Title><Activity size={20} /> Activity log</Dialog.Title><Dialog.Description id="activity-description">Device operations and application events.</Dialog.Description></div><Dialog.Close asChild><Button variant="ghost" aria-label="Close activity log"><X size={18} /></Button></Dialog.Close></div>
      <div className="activity-current" aria-label="Current status" role="status"><strong>{device ? deviceLabels[device.phase] : 'Reading recorder status…'}</strong>{device?.error && <p className="danger-text">{device.error}</p>}</div>
      <div className="activity-scroll">{open && <ProcessingQueue onNavigate={() => setOpen(false)} />}<div className="activity-list">{entries.length === 0 ? <div className="activity-empty"><CheckCircle2 size={28} /><p>No logged events</p><span>New events will appear here. Current status is shown above.</span></div> : [...entries].reverse().map(entry => <div className={`activity-row activity-${entry.type}`} key={entry.id}><span className="activity-dot" /><div><p>{entry.message}</p>{entry.details && <small>{entry.details}</small>}<time>{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div></div>)}</div>
      </div>
      <div className="panel-footer"><span>{entries.length} event{entries.length === 1 ? '' : 's'}</span><Button disabled={entries.length === 0} onClick={() => { void clearActivity().catch(reportError) }}><Trash2 size={14} />Clear log</Button></div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>
}
