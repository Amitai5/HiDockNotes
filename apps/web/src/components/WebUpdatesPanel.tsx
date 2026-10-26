import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { browserDevice } from '../services/browser-device'
import { desktopBridge } from '../services/desktop-recorder'
import { activateWebUpdate, reloadWebApp } from '../services/web-update'
import { Button } from './ui'

let registration: ServiceWorkerRegistration | undefined
let initialized = false
let state = { available: false, updating: false, message: '' }
const events = new EventTarget()
function publish(patch: Partial<typeof state>): void { state = { ...state, ...patch }; events.dispatchEvent(new Event('update')) }
const snapshot = () => state
function subscribe(listener: () => void): () => void { events.addEventListener('update', listener); return () => events.removeEventListener('update', listener) }
export function initializePwa(): void {
  // The desktop is an online server client. Its next launch must load the server UI.
  if (initialized || desktopBridge() || !window.isSecureContext || !('serviceWorker' in navigator)) return
  initialized = true
  const available = (): void => publish({ available: true })
  registerSW({
    immediate: true,
    onNeedRefresh: available,
    // A different tab may activate the worker. Each tab keeps its own unload choice.
    onNeedReload: available,
    onRegisteredSW: (_url, value) => {
      registration = value
      if (!value) return
      const check = (): void => { void value.update().catch(() => undefined) }
      setInterval(check, 3600000)
      window.addEventListener('focus', check)
    }
  })
}
function blockedUpdate(): string | null {
  if (browserDevice.busy) return 'Finish USB sync or live capture before updating.'
  // Consult the same unload guards that protect pending note saves and recovery.
  if (!window.dispatchEvent(new Event('beforeunload', { cancelable: true }))) return 'Save or resolve your unsaved note before updating.'
  return null
}
async function update(): Promise<void> {
  if (state.updating) return
  const blocked = blockedUpdate()
  if (blocked) { publish({ message: blocked }); return }
  publish({ updating: true, message: 'Loading the latest app…' })
  try {
    const current = registration ?? await navigator.serviceWorker.getRegistration()
    await activateWebUpdate(current)
    const blocked = blockedUpdate()
    if (blocked) { publish({ updating: false, message: blocked }); return }
    reloadWebApp()
  } catch (error) { publish({ updating: false, message: error instanceof Error ? error.message : 'The update could not load. Check your connection and retry.' }) }
}
function useWebUpdate() { return { ...useSyncExternalStore(subscribe, snapshot), update: () => { void update() } } }
export function WebUpdateNotice(): JSX.Element | null {
  const { available, updating, message, update } = useWebUpdate()
  if (!available) return null
  return <aside className="web-update-notice" aria-label="App update"><div role="status"><strong>{updating ? 'Updating your app' : 'A new version is ready'}</strong><p>{message || 'Update to load the latest interface from your server.'}</p></div><Button variant="primary" busy={updating} onClick={update}>{updating ? 'Updating…' : 'Update app'}</Button></aside>
}
export function WebUpdatesPanel(): JSX.Element {
  const { available, updating, message, update } = useWebUpdate()
  return <section className="settings-section"><h2>Web app updates</h2><p>{desktopBridge() ? 'The desktop loads the current interface from your server when it opens.' : !window.isSecureContext ? 'Reload this page after updating the server.' : available ? 'A new version is ready.' : 'The app checks for updates automatically.'}</p><div className="toolbar-actions"><Button disabled={!available} busy={updating} onClick={update}>{updating ? 'Updating…' : 'Update app'}</Button><a className="button" href="https://github.com/Amitai5/HiDockNotes/releases" target="_blank" rel="noreferrer">Releases &amp; server images</a></div>{message && <p role="status">{message}</p>}</section>
}
