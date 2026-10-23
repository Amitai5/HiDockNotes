import { useEffect, useState, type ReactNode } from 'react'
import { BrandMark } from './BrandMark'
import { connectEvents, request, setCsrf, clientEvents } from '../services/http'
import { browserDevice } from '../services/browser-device'
interface Session { authenticated: boolean; setupRequired?: boolean; username?: string; csrf?: string }
export function AuthGate({ children }: { children: ReactNode }): JSX.Element {
  const [session, setSession] = useState<Session | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { void request<Session>('/api/v1/auth/session').then(value => { setCsrf(value.csrf ?? ''); setSession(value) }).catch(error => setError(error.message)); const signedOut = () => { setCsrf(''); setSession({ authenticated: false }); void browserDevice.disconnect().catch(() => undefined) }; clientEvents.addEventListener('signed-out', signedOut); return () => clientEvents.removeEventListener('signed-out', signedOut) }, [])
  useEffect(() => session?.authenticated ? connectEvents() : undefined, [session?.authenticated])
  if (session?.authenticated) return <>{children}</>
  return <main className="auth-screen"><form className="auth-card" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError(''); void request<Session>('/api/v1/auth/' + (session?.setupRequired ? 'setup' : 'login'), { username: form.get('username'), password: form.get('password'), ...(session?.setupRequired ? { token: form.get('token') } : {}) }).then(value => { setCsrf(value.csrf ?? ''); setSession(value) }).catch(error => setError(error.message)).finally(() => setBusy(false)) }}>
    <BrandMark size={72} /><h1>{session?.setupRequired ? 'Set up your library' : 'Welcome to HiDockNotes'}</h1><p className="muted">Your recordings, on your server.</p>
    {!session && !error ? <p role="status">Connecting…</p> : <>{session?.setupRequired && <label>Server setup code<input aria-label="Server setup code" name="token" required autoComplete="off" minLength={8} maxLength={8} spellCheck={false} autoCapitalize="characters" pattern="[A-Ha-hJ-Nj-nP-Zp-z2-9]{8}" /><small>Copy the eight-character code from the container logs.</small></label>}<label>Username<input name="username" required autoComplete="username" maxLength={80} /></label><label>Password<input name="password" type="password" required minLength={session?.setupRequired ? 12 : undefined} maxLength={200} autoComplete={session?.setupRequired ? 'new-password' : 'current-password'} /></label><button className="button button-primary" disabled={busy}>{busy ? 'Connecting…' : session?.setupRequired ? 'Create owner account' : 'Sign in'}</button></>}
    {error && <p role="alert" className="danger">{error}</p>}
  </form></main>
}
