import { useEffect, useState } from 'react'
import { Button } from './ui'
import { browserDevice, usbAvailability } from '../services/browser-device'
import { request } from '../services/http'
import { reportError } from '../store/useAppStore'
import { recoverBrowserCaptures } from '../services/browser-capture'
export function BrowserSyncTools(): JSX.Element {
  const [capturing, setCapturing] = useState(false), [busy, setBusy] = useState(false), [captures, setCaptures] = useState<{ id: string; state: string; bytes: number; created_at: string }[]>([])
  const refresh = () => { void request<typeof captures>('/api/v1/captures').then(setCaptures).catch(reportError) }
  useEffect(() => { refresh(); return browserDevice.api.onState(() => { setCapturing(browserDevice.isCapturing) }) }, [])
  return <section className="browser-sync-tools"><p className="muted">{usbAvailability() ?? 'Keep this tab or installed app open while syncing. USB runs on this computer; recordings are saved on the server.'}</p><div className="toolbar-actions"><Button disabled={busy} onClick={() => { setBusy(true); void (capturing ? browserDevice.stopCapture() : browserDevice.startCapture()).then(() => { setCapturing(browserDevice.isCapturing); refresh() }).catch(reportError).finally(() => setBusy(false)) }}>{capturing ? 'Stop & save live capture' : 'Start live capture'}</Button><Button disabled={busy || capturing} onClick={() => { setBusy(true); void recoverBrowserCaptures().then(refresh).catch(reportError).finally(() => setBusy(false)) }}>Recover browser capture</Button></div>{captures.filter(item => item.bytes > 0).map(item => <div className="setting-row" key={item.id}><span>{item.state === 'recording' ? 'Capture in progress' : 'Interrupted capture'} · {new Date(item.created_at).toLocaleString()}</span><Button disabled={capturing || busy} onClick={() => { setBusy(true); void request('/api/v1/captures/' + item.id + '/finish', {}).then(refresh).catch(reportError).finally(() => setBusy(false)) }}>Save recorded audio</Button></div>)}</section>
}
