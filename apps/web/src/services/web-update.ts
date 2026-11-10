/** Waits for an update to become active, including an update consumed by another tab. */
export async function activateWebUpdate(registration: ServiceWorkerRegistration | undefined): Promise<void> {
  const worker = registration?.waiting ?? registration?.installing ?? registration?.active
  if (!worker) throw new Error('The app update is not available. Reload this page to check again.')
  if (worker.state === 'activated') return
  await new Promise<void>((resolve, reject) => {
    let settled = false
    let requestedState: ServiceWorkerState | null = null
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true; clearTimeout(timer); worker.removeEventListener('statechange', changed)
      if (error) reject(error); else resolve()
    }
    const changed = (): void => {
      if (worker.state === 'activated') finish()
      else if (worker.state === 'redundant') finish(new Error('The app update changed while loading. Try updating again.'))
      else if ((worker.state === 'installed' || worker.state === 'installing') && requestedState !== worker.state) {
        // An installing worker may not have registered its message handler yet.
        // Request activation again once installation actually completes.
        requestedState = worker.state
        try { worker.postMessage({ type: 'SKIP_WAITING' }) } catch (error) { finish(error instanceof Error ? error : new Error('The app update could not start. Try updating again.')) }
      }
    }
    const timer = setTimeout(() => finish(new Error('The app update did not finish. Check your connection and retry.')), 15000)
    worker.addEventListener('statechange', changed)
    changed()
  })
}

/** Reloads the current route after the update and unload guards have settled. */
export function reloadWebApp(): void { window.location.reload() }
