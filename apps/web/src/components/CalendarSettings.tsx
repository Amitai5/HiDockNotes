import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { CalendarDays, ExternalLink, RefreshCw, Trash2, X } from 'lucide-react'
import type { CalendarState, CalendarSource } from '../shared/calendar'
import { Button } from './ui'

export function CalendarSettings(): JSX.Element {
  const [state, setState] = useState<CalendarState>({ sources: [], syncing: false, error: null })
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [remove, setRemove] = useState<CalendarSource | null>(null)
  useEffect(() => {
    const api = appClient.calendar
    if (!api) return
    let active = true
    const refresh = (): void => { void api.state().then(value => { if (active) setState(value) }).catch(value => { if (active) setError(value instanceof Error ? value.message : 'Calendars could not be loaded.') }) }
    refresh(); const off = api.onChanged(refresh)
    return () => { active = false; off() }
  }, [])
  async function act(action: () => Promise<CalendarState>): Promise<boolean> {
    setBusy(true); setError('')
    try { setState(await action()); return true } catch (value) { setError(value instanceof Error ? value.message : 'The calendar could not be changed.'); return false } finally { setBusy(false) }
  }
  return <section className="settings-section" id="google-calendar" tabIndex={-1}><h2><CalendarDays size={18} />Google Calendar</h2><p>Connect a private iCal link. Read-only · refreshes every 15 minutes.</p>
    <form className="calendar-connect-form" onSubmit={event => { event.preventDefault(); const value = url; setUrl(''); void act(() => appClient.calendar.connect(name, value)).then(success => { if (success) setName('') }) }}><label>Calendar name<input aria-label="Calendar name" placeholder="Work calendar" maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy || state.syncing} /></label><label>Private iCal link<input aria-label="Private iCal link" type="password" autoComplete="off" spellCheck={false} placeholder="Paste Google Calendar’s secret iCal address" maxLength={2000} value={url} onChange={event => setUrl(event.target.value)} disabled={busy || state.syncing} /></label><Button type="submit" variant="primary" busy={busy} disabled={!name.trim() || !url.trim() || state.syncing}>Connect calendar</Button></form>
    <details className="settings-details calendar-help"><summary>Where to find the link</summary><p>Google Calendar → Settings → your calendar → Integrate calendar → Secret address in iCal format.</p><p>Keep this link private. Some work or school accounts restrict it.</p><Button onClick={() => { void appClient.calendar.openSettings().catch(value => setError(value instanceof Error ? value.message : 'Google Calendar could not be opened.')) }}><ExternalLink size={14} />Open Google Calendar settings</Button></details>
    <div className="calendar-source-list">{state.sources.map(source => <div className="calendar-source" key={source.id}><CalendarDays size={20} /><div><strong>{source.name}</strong><span>{source.connected ? `${source.events} events${source.lastSyncedAt ? ' · ' + new Date(source.lastSyncedAt).toLocaleString() : ''}` : 'Reconnect with its private link'}</span>{source.error && <p className="danger-text">{source.error}</p>}</div><Button variant="ghost" aria-label={`Refresh ${source.name}`} disabled={busy || state.syncing || !source.connected} onClick={() => { void act(() => appClient.calendar.refresh(source.id)) }}><RefreshCw size={16} className={state.syncing ? 'animate-spin' : ''} /></Button><Button variant="ghost" aria-label={`Remove ${source.name}`} disabled={busy || state.syncing} onClick={() => setRemove(source)}><Trash2 size={16} /></Button></div>)}</div>
    {(error || state.error) && <p role="alert" className="danger-text">{error || state.error}</p>}
    <Dialog.Root open={!!remove} onOpenChange={value => { if (!value && !busy) setRemove(null) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog"><div className="panel-heading"><Dialog.Title>Remove calendar?</Dialog.Title><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label="Close calendar removal"><X size={17} /></Button></Dialog.Close></div><Dialog.Description>Remove {remove?.name}, its cached events, and recording links. Your recordings and notes are kept.</Dialog.Description><div className="dialog-actions"><Button disabled={busy} onClick={() => setRemove(null)}>Cancel</Button><Button variant="danger" busy={busy} onClick={() => { if (remove) void act(() => appClient.calendar.disconnect(remove.id, true)).then(success => { if (success) setRemove(null) }) }}>Remove calendar</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>
}
