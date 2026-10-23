import { useEffect, useState } from 'react'
import { Download, LogOut } from 'lucide-react'
import { browserDevice } from '../services/browser-device'
import { clientEvents, request } from '../services/http'
import { reportError } from '../store/useAppStore'
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function BrowserControls(): JSX.Element {
  const [install, setInstall] = useState<InstallPrompt | null>(null)
  useEffect(() => { const listener = (event: Event) => { event.preventDefault(); setInstall(event as InstallPrompt) }; window.addEventListener('beforeinstallprompt', listener); const before = (event: BeforeUnloadEvent) => { if (browserDevice.busy) { event.preventDefault(); event.returnValue = '' } }; window.addEventListener('beforeunload', before); return () => { window.removeEventListener('beforeinstallprompt', listener); window.removeEventListener('beforeunload', before) } }, [])
  return <div className="browser-controls">{install && <button onClick={() => { void install.prompt().then(() => install.userChoice).then(() => setInstall(null)) }}><Download size={16} /><span>Install</span></button>}<button title="Sign out" aria-label="Sign out" onClick={() => { void browserDevice.disconnect().catch(reportError).then(() => request('/api/v1/auth/logout', {})).then(() => clientEvents.dispatchEvent(new Event('signed-out'))).catch(reportError) }}><LogOut size={16} /></button></div>
}
