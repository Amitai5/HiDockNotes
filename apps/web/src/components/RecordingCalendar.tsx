import { appClient } from '../services/app-client'
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { CalendarDays, Link2, Unlink, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CalendarEvent, CalendarPerson, RecordingCalendar as CalendarDetail } from '../shared/calendar'
import { Button } from './ui'

const personName = (person: CalendarPerson): string => person.name ?? person.email ?? 'Unnamed invitee'
function eventTime(event: CalendarEvent): string {
  if (event.allDay) return new Date(event.start).toLocaleDateString(undefined, { timeZone: 'UTC' }) + ' · All day'
  return new Date(event.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' – ' + new Date(event.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
export function RecordingCalendar({ id, disabled }: { id: string; disabled?: boolean }): JSX.Element | null {
  const [detail, setDetail] = useState<CalendarDetail>({ linked: null, suggestions: [] }), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [titleConfirm, setTitleConfirm] = useState(false)
  useEffect(() => {
    const api = appClient.calendar
    if (!api) return
    let active = true
    const refresh = (): void => { void api.forRecording(id).then(value => { if (active) { setDetail(value); setError('') } }).catch(value => { if (active) setError(value instanceof Error ? value.message : 'Calendar details could not be loaded.') }) }
    refresh(); const offCalendar = api.onChanged(refresh), offLibrary = appClient.library.onChanged(refresh)
    return () => { active = false; offCalendar(); offLibrary() }
  }, [id])
  if (!appClient.calendar) return null
  async function link(eventId: string | null): Promise<void> {
    setBusy(true); setError('')
    try { await appClient.calendar.link(id, eventId); setDetail(await appClient.calendar.forRecording(id)); setOpen(false) } catch (value) { setError(value instanceof Error ? value.message : 'The event could not be linked.') } finally { setBusy(false) }
  }
  return <section className="recording-calendar" aria-label="Linked calendar event"><div className="calendar-recording-heading"><h2><CalendarDays size={16} />Calendar event</h2><Button variant="ghost" disabled={disabled || busy} onClick={() => setOpen(true)}><Link2 size={14} />{detail.linked ? 'Change' : 'Link meeting'}</Button></div>
    {detail.linked && <div className="linked-calendar-event"><strong>{detail.linked.title}</strong><span>{eventTime(detail.linked)} · {detail.linked.calendarName}</span>{(detail.linked.cancelled || !detail.linked.available) && <p className="danger-text">{detail.linked.cancelled ? 'Cancelled in calendar' : 'Not in the latest calendar feed'}</p>}{detail.linked.organizer && <p><b>Calendar organizer:</b> {personName(detail.linked.organizer)}</p>}{detail.linked.invitees.length > 0 && <p><b>Invited:</b> {detail.linked.invitees.map(personName).join(', ')}</p>}{detail.linked.description && <details><summary>Agenda</summary><p className="calendar-agenda">{detail.linked.description}</p></details>}{detail.linked.location && <p>{detail.linked.location}</p>}<div className="toolbar-actions"><Button disabled={disabled || busy} onClick={() => { setError(''); setTitleConfirm(true) }}>Use event title</Button><Button variant="ghost" disabled={disabled || busy} onClick={() => { void link(null) }}><Unlink size={14} />Unlink</Button></div></div>}
    {error && <p role="alert" className="danger-text">{error}</p>}
    <Dialog.Root open={open} onOpenChange={value => { if (!busy) setOpen(value) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog calendar-event-dialog"><div className="panel-heading"><Dialog.Title>Link a meeting</Dialog.Title><Dialog.Close asChild><Button variant="ghost" disabled={busy} aria-label="Close meeting suggestions"><X size={17} /></Button></Dialog.Close></div><Dialog.Description>Events near this recording. Invitees do not establish who attended.</Dialog.Description><div className="calendar-event-list">{detail.suggestions.map(event => <button key={event.id} disabled={busy} onClick={() => { void link(event.id) }}><CalendarDays size={19} /><span><strong>{event.title}</strong><small>{eventTime(event)} · {event.calendarName}</small></span><Link2 size={16} /></button>)}{!detail.suggestions.length && <p className="muted">No nearby events. Connect or refresh a calendar in Settings.</p>}</div><Link className="text-link" to="/settings?tab=calendars">Calendar settings</Link>{error && <p role="alert" className="danger-text">{error}</p>}</Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={titleConfirm} onOpenChange={value => { if (!busy) setTitleConfirm(value) }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="confirmation-dialog"><div className="panel-heading"><Dialog.Title>Use calendar title?</Dialog.Title></div><Dialog.Description>Replace this recording’s current title with “{detail.linked?.title}”.</Dialog.Description>{error && <p role="alert" className="danger-text">{error}</p>}<div className="dialog-actions"><Button disabled={busy} onClick={() => setTitleConfirm(false)}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => { setBusy(true); setError(''); void appClient.calendar.useTitle(id).then(() => setTitleConfirm(false)).catch(value => setError(value instanceof Error ? value.message : 'The title could not be changed.')).finally(() => setBusy(false)) }}>Use event title</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>
}
