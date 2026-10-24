import { useEffect, useState } from 'react'
import type { ServerConnectionClient } from '../shared/server-connection'
import { Button } from './ui'

export function ServerConnectionPanel({ connection = window.hidockConnection }: { connection?: ServerConnectionClient }): JSX.Element | null {
  const [origin, setOrigin] = useState(''), [current, setCurrent] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (connection) void connection.get().then(value => { setCurrent(value.origin); setOrigin(value.origin ?? '') }).catch(error => setError(error.message)) }, [connection])
  if (!connection) return null
  function change(action: () => Promise<void>): void { setBusy(true); setError(''); void action().catch(error => { setError(error.message); setBusy(false) }) }
  return <section className="settings-section" id="server-connection" tabIndex={-1}>
    <h2>Server connection</h2>
    <p>{current ? `Connected to ${current}. USB runs on this computer; your server stores and processes recordings.` : 'Use your server library in this app, with native USB on this computer. Sign in with your server account after connecting.'}</p>
    <form className="name-form" onSubmit={event => { event.preventDefault(); change(() => connection!.connect(origin)) }}>
      <input aria-label="HiDockNotes server address" type="url" placeholder="https://notes.example.com" required value={origin} onChange={event => setOrigin(event.target.value)} disabled={busy} />
      <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Reopening…' : 'Connect to server'}</Button>
    </form>
    {current && <Button disabled={busy} onClick={() => change(() => connection.useLocal())}>Use local library</Button>}
    <p className="muted">Switching reopens the app. Existing local recordings stay on this computer; use a complete backup and restore to move them to the server.</p>
    {error && <p role="alert" className="danger">{error}</p>}
  </section>
}
