import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { browserDevice } from '../services/browser-device'
import { Button } from './ui'
let refresh: ((reload?: boolean) => Promise<void>) | undefined
let updateAvailable = false
const events = new EventTarget()
export function initializePwa(): void { refresh = registerSW({ immediate: true, onNeedRefresh: () => { updateAvailable = true; events.dispatchEvent(new Event('update')) }, onRegisteredSW: (_url, registration) => { if (registration) setInterval(() => { void registration.update().catch(() => undefined) }, 3600000) } }) }
export function WebUpdatesPanel(): JSX.Element {
  const [available, setAvailable] = useState(updateAvailable), [message, setMessage] = useState('')
  useEffect(() => { const listener = () => setAvailable(true); events.addEventListener('update', listener); return () => events.removeEventListener('update', listener) }, [])
  return <section className="settings-section"><h2>Web app updates</h2><p>{available ? 'A new version is ready.' : 'The app checks for updates automatically.'}</p><div className="toolbar-actions"><Button disabled={!available} onClick={() => { if (browserDevice.busy) { setMessage('Finish USB sync or live capture before updating.'); return }; void refresh?.(true) }}>Update app</Button><a className="button" href="https://github.com/Amitai5/HiDockNotes/releases" target="_blank" rel="noreferrer">Releases & server images</a></div>{message && <p role="status">{message}</p>}</section>
}
