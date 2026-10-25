import { usbAvailability } from '../services/browser-device'
import { BrowserSyncTools } from '../components/BrowserSyncTools'
import { appClient } from '../services/app-client'
import { useEffect, useMemo, useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Battery, Cable, CheckCircle2, Clock3, Download, FileAudio2, HardDrive, RefreshCw, Search, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react'
import { Button, EmptyState, Toggle, formatBytes, formatDuration } from '../components/ui'
import type { UseDevicePipelineResult } from '../hooks/useDevicePipeline'
import { useAppStore, reportError, updateSettings } from '../store/useAppStore'
import type { DownloadView } from '../shared/contracts'

export function modelName(model?: string): string { return model ? model.replace(/^hidock-/, '').replace(/-/g, ' ').toUpperCase() : 'P1' }
export function SyncPage({ device }: { device: UseDevicePipelineResult }): JSX.Element {
  const { state, files } = device
  const settings = useAppStore(s => s.settings)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [downloads, setDownloads] = useState<DownloadView[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const connected = state.device !== null && state.phase !== 'disconnected' && state.phase !== 'error'
  const busy = !['idle', 'disconnected', 'error'].includes(state.phase)
  const visible = useMemo(() => files.filter(f => f.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0)), [files, filter])
  const newFiles = files.filter(f => !f.localVerified && !f.active)
  const selectableFiles = visible.filter(f => !f.localVerified && !f.active)
  const selectedFiles = newFiles.filter(f => selected.has(f.name))
  async function perform(name: string, action: () => Promise<unknown>): Promise<void> { setPending(name); try { await action() } catch (error) { reportError(error) } finally { setPending(null) } }
  useEffect(() => {
    let mounted = true
    void appClient.devicePipeline.getDownloads().then(s => { if (mounted) setDownloads(s.queue) }).catch(reportError)
    const remove = appClient.devicePipeline.onDownloads(s => setDownloads(s.queue))
    return () => { mounted = false; remove() }
  }, [])
  const unavailable = usbAvailability()
  const progress = state.downloadProgress
  return <div className="page sync-page"><BrowserSyncTools />
    <div className="page-heading"><div><h1>Device sync</h1><p>Sync from this browser to your server.</p></div><Button variant={connected ? 'secondary' : 'primary'} busy={pending === 'connect'} disabled={!connected && !!unavailable} onClick={() => { void perform('connect', connected ? device.disconnect : device.connect) }}><Cable size={16} />{connected ? 'Disconnect' : 'Connect device'}</Button></div>
    <div className={`device-banner ${connected ? 'is-connected' : ''}`}><div className="device-banner-icon"><Smartphone size={27} /></div><div><h2>{connected ? `${modelName(state.device?.model)} is connected` : state.phase === 'connecting' ? 'Connecting to your recorder' : 'No device connected'}</h2><p>{state.error || (connected ? busy ? `Device is ${state.phase}. Your files stay safe on the recorder.` : `${files.length} recording${files.length === 1 ? '' : 's'} on your device · ${newFiles.length} ready to download` : 'Connect your P1 with a USB cable to see your recordings.')}</p></div>{!connected && <Button disabled={busy || !!unavailable} onClick={() => { void perform('connect', device.connect) }}>{busy ? 'Connecting…' : 'Connect'}</Button>}{connected && <span className="connection-badge"><span />Connected</span>}</div>
    <div className="device-facts">
      <div><span><Smartphone size={15} />Model</span><strong>{state.device ? modelName(state.device.model) : '—'}</strong></div>
      <div><span>Firmware</span><strong>{state.device?.firmwareVersion ?? '—'}</strong><small>Updates disabled</small></div>
      <div><span><Battery size={16} />Battery</span><strong>{state.device?.battery ? `${state.device.battery.batteryLevel}%` : '—'}</strong><small>{state.device?.battery?.status === 'charging' ? 'Charging' : ''}</small></div>
      <div><span><HardDrive size={15} />Storage</span><strong>{state.device?.storage ? `${formatBytes(state.device.storage.used)} / ${formatBytes(state.device.storage.capacity)}` : '—'}</strong><small>{state.device?.storage ? `${state.device.storage.freePercent}% free` : ''}</small></div>
      <div><span><Clock3 size={15} />Device time</span><strong>{state.device?.time ? new Date(state.device.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div>
      <Button disabled={!connected || busy} busy={pending === 'time'} onClick={() => { void perform('time', () => appClient.devicePipeline.syncTime()) }}><RefreshCw size={14} />Sync time</Button>
    </div>
    <div className="recordings-toolbar"><h2>Recordings on device <span>{files.length > 0 && files.length}</span></h2><div className="toolbar-actions"><label className="input-with-icon file-filter"><Search size={15} /><input aria-label="Filter device files" placeholder="Filter files" value={filter} onChange={e => setFilter(e.target.value)} /></label><Button disabled={!connected || busy} busy={pending === 'refresh'} onClick={() => { void perform('refresh', device.sync) }}><RefreshCw size={14} />Refresh</Button><Button variant="primary" disabled={!connected || busy || (selectedFiles.length === 0 && newFiles.length === 0)} onClick={() => { void perform('download', () => appClient.devicePipeline.download((selectedFiles.length ? selectedFiles : newFiles).map(f => f.name))) }}><Download size={15} />{selectedFiles.length ? `Download ${selectedFiles.length}` : 'Download new'}</Button></div></div>
    {state.scanProgress && <div className="scan-status"><RefreshCw size={14} className="animate-spin" />Finding recordings… {state.scanProgress.current} / {state.scanProgress.total || '…'}</div>}
    {progress && <div className="download-progress" role="region" aria-label="Current recording transfer"><div><Download size={17} /><span><strong>{progress.filename}</strong><small>{progress.stage === 'uploading' ? 'Saving to server · ' : progress.stage === 'verifying' ? 'Verifying server copy · ' : 'Downloading from device · '}{formatBytes(progress.bytesDownloaded)} of {formatBytes(progress.totalBytes)} · File {progress.current} of {progress.total}</small></span><Button onClick={() => { void device.cancel().catch(reportError) }}><X size={14} />Cancel</Button></div><progress aria-label="Recording transfer progress" max={progress.totalBytes || 1} value={progress.bytesDownloaded} /></div>}
    <div className="device-table-wrap"><table className="device-table"><thead><tr><th className="check-column"><input type="checkbox" aria-label="Select all device files" disabled={!selectableFiles.length || busy} checked={selectableFiles.length > 0 && selectableFiles.every(f => selected.has(f.name))} onChange={e => setSelected(e.target.checked ? new Set(selectableFiles.map(f => f.name)) : new Set())} /></th><th>Recording</th><th>Recorded</th><th>Duration</th><th>Size</th><th>Status</th><th className="text-right">Actions</th></tr></thead><tbody>{visible.map(file => {
      const queued = downloads.find(d => d.filename === file.name)
      return <tr key={file.name}><td><input type="checkbox" aria-label={`Select ${file.name}`} disabled={busy || file.active || file.localVerified} checked={selected.has(file.name) && !file.active && !file.localVerified} onChange={e => setSelected(prev => { const next = new Set(prev); if (e.target.checked) next.add(file.name); else next.delete(file.name); return next })} /></td><td><div className="filename"><FileAudio2 size={19} /><span>{file.name}</span></div></td><td>{file.time ? file.time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}<small className="block">{file.time?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></td><td>{formatDuration(file.duration)}</td><td>{formatBytes(file.length)}</td><td>{file.active ? <span className="status" title="Waiting for the recorder to confirm this file is closed">On hold</span> : file.localVerified ? <span className="status status-verified"><CheckCircle2 size={13} />Verified</span> : queued ? <span className={`status ${queued.status === 'failed' ? 'status-failed' : ''}`} title={queued.error}>{queued.status === 'downloading' ? `${Math.round(queued.progress)}%` : queued.status === 'uploading' ? `Saving ${Math.round(queued.progress)}%` : queued.status === 'verifying' ? 'Verifying' : queued.status}</span> : <span className="status">New</span>}</td><td><div className="row-actions"><Button variant="ghost" aria-label={`Download ${file.name}`} disabled={busy || file.active || file.localVerified} onClick={() => { void perform('download', () => appClient.devicePipeline.download([file.name])) }}><Download size={15} /></Button><Button variant="ghost" aria-label={`Delete ${file.name} from device`} title={file.localVerified ? 'Delete from device' : 'Copy to the server and verify first'} disabled={busy || file.active || !file.localVerified} onClick={() => setDeleting(file.name)}><Trash2 size={15} /></Button></div></td></tr>
    })}</tbody></table>{visible.length === 0 && <EmptyState icon={<FileAudio2 size={30} />} title={filter ? 'No matching recordings' : files.length ? 'No files to show' : 'Ready when you are'}>{filter ? 'Try a different filename.' : connected ? 'New recordings will appear here when your device finishes saving them.' : 'Your device recordings will appear here.'}</EmptyState>}</div>
    <div className="sync-preferences"><label><Toggle label="Auto-download new recordings" checked={settings?.autoDownload ?? false} onChange={value => { void updateSettings({ autoDownload: value }) }} /><span>Auto-download new recordings</span></label><label><Toggle label="Delete from device after verified copy" checked={settings?.autoDeleteFromDevice ?? false} onChange={value => { void updateSettings({ autoDeleteFromDevice: value }) }} /><span>Delete from device after verified copy</span></label></div>
    <p className="safety-note"><ShieldCheck size={15} />{settings?.autoDeleteFromDevice ? 'After each successful copy, closed recordings are deleted from the device only after server verification. Your Library copy is kept.' : 'Files stay on your device until you delete them or enable deletion after a verified copy.'}</p>
    <AlertDialog.Root open={deleting !== null} onOpenChange={open => { if (!open) setDeleting(null) }}><AlertDialog.Portal><AlertDialog.Overlay className="dialog-overlay" /><AlertDialog.Content className="confirmation-dialog"><AlertDialog.Title>Delete from your recorder?</AlertDialog.Title><AlertDialog.Description>The app will recheck the verified server copy of <strong>{deleting}</strong> before removing it from the device. Your server recording stays in the Library. No audio is downloaded from the device.</AlertDialog.Description><div className="dialog-actions"><AlertDialog.Cancel asChild><Button>Keep recording</Button></AlertDialog.Cancel><AlertDialog.Action asChild><Button variant="danger" onClick={() => { if (deleting) void perform('delete', () => device.deleteFile(deleting, true)) }}><Trash2 size={14} />Delete from device</Button></AlertDialog.Action></div></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
  </div>
}
