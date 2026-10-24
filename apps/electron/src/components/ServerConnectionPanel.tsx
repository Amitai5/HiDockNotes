import { useEffect, useState } from 'react'
import type { ServerConnectionClient } from '../shared/server-connection'

export function ServerConnectionPanel({ connection = window.hidockConnection }: { connection?: ServerConnectionClient }): JSX.Element | null {
  const [origin, setOrigin] = useState(''), [current, setCurrent] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    if (connection) void connection.get().then(value => { if (active) { setCurrent(value.origin); setOrigin(value.origin ?? ''); setError(value.error ?? '') } }).catch(error => { if (active) setError(error.message) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [connection])
  if (!connection) return null
  function connect(): void { setBusy(true); setError(''); void connection!.connect(origin).catch(error => { setError(error.message); setBusy(false) }) }
  return <section className="settings-section" id="server-connection" tabIndex={-1}>
    <h2>Server connection</h2>
    <p>{current ? `Server: ${current}. Sign in with your server account after connecting.` : 'Enter the HTTPS address of your HiDockNotes server, then sign in with your server account.'}</p>
    <form className="name-form" onSubmit={event => { event.preventDefault(); connect() }}>
      <label htmlFor="server-address">HiDockNotes server address</label>
      <input id="server-address" type="url" placeholder="https://notes.example.com" required value={origin} onChange={event => setOrigin(event.target.value)} disabled={busy || loading} />
      <button className="button button-primary" type="submit" disabled={busy || loading}>{busy ? 'Reopening…' : 'Connect to server'}</button>
    </form>
    <p className="muted">Your server stores recordings, transcripts, settings and accounts, and runs all processing. This app connects your USB recorder and needs the server to use your library.</p>
    {error && <p role="alert" className="danger">{error}</p>}
  </section>
}
