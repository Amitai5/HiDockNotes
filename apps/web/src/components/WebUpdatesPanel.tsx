import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { browserDevice } from '../services/browser-device'
import { desktopBridge } from '../services/desktop-recorder'
import { Button } from './ui'
let refresh: ((reload?: boolean) => Promise<void>) | undefined
let updateAvailable = false
const events = new EventTarget()
export function initializePwa(): void {
  // The desktop is an online server client. Its next launch must load the server UI.
  if (desktopBridge() || !window.isSecureContext || !('serviceWorker' in navigator)) return
  refresh = registerSW({
    immediate: true,
    onNeedRefresh: () => { updateAvailable = true; events.dispatchEvent(new Event('update')) },
    onRegisteredSW: (_url, registration) => {
      if (!registration) return
      const check = (): void => { void registration.update().catch(() => undefined) }
      setInterval(check, 3600000)
      window.addEventListener('focus', check)
    }
  })
}
function useWebUpdate() {
  const [available, setAvailable] = useState(updateAvailable), [message, setMessage] = useState('')
  useEffect(() => { const listener = () => setAvailable(true); events.addEventListener('update', listener); return () => events.removeEventListener('update', listener) }, [])
  const update = (): void => {
    if (browserDevice.busy) { setMessage('Finish USB sync or live capture before updating.'); return }
    // Consult the same unload guards that protect pending note saves and recovery.
    if (!window.dispatchEvent(new Event('beforeunload', { cancelable: true }))) { setMessage('Save or resolve your unsaved note before updating.'); return }
    setMessage('')
    void refresh?.(true).catch(() => setMessage('The update could not load. Check your connection and retry.'))
  }
  return { available, message, update }
}
export function WebUpdateNotice(): JSX.Element | null {
  const { available, message, update } = useWebUpdate()
  if (!available) return null
  return <aside className="web-update-notice" aria-label="App update"><div role="status"><strong>A new version is ready</strong><p>{message || 'Update to load the latest interface from your server.'}</p></div><Button variant="primary" onClick={update}>Update app</Button></aside>
}
export function WebUpdatesPanel(): JSX.Element {
  const { available, message, update } = useWebUpdate()
  return <section className="settings-section"><h2>Web app updates</h2><p>{desktopBridge() ? 'The desktop loads the current interface from your server when it opens.' : !window.isSecureContext ? 'Reload this page after updating the server.' : available ? 'A new version is ready.' : 'The app checks for updates automatically.'}</p><div className="toolbar-actions"><Button disabled={!available} onClick={update}>Update app</Button><a className="button" href="https://github.com/Amitai5/HiDockNotes/releases" target="_blank" rel="noreferrer">Releases &amp; server images</a></div>{message && <p role="status">{message}</p>}</section>
}
