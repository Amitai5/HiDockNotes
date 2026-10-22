import { createHash, randomUUID } from 'node:crypto'
import type { CalendarEvent, CalendarPerson, CalendarState, RecordingCalendar } from '../../../src/shared/calendar'
import type { SecretEncryption } from '../ai/credentials'
import { queryAll, queryOne, renameRecording, run, runInTransaction } from '../services/database'
import type { CalendarWindow, ParsedCalendarEvent } from './calendar-parser'

interface SourceRow { id: string; name: string; ciphertext: Buffer | null; last_synced_at: string | null; error: string | null; events: number }
interface EventRow { id: string; source_id: string; calendar_name: string; title: string; description: string; location: string; start: string; end: string; all_day: number; organizer: string | null; invitees: string; cancelled: number; available: number }
interface Dependencies { encryption: SecretEncryption; parse(text: string, window: CalendarWindow, signal: AbortSignal): Promise<ParsedCalendarEvent[]>; changed(): void; libraryChanged(): void; request?: typeof fetch; now?: () => Date; timeZone?: string }
const EVENT_SELECT = 'SELECT e.*,s.name AS calendar_name FROM calendar_events e JOIN calendar_sources s ON s.id=e.source_id'
const DAY = 86400000

export function validateGoogleCalendarLink(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Paste the Google Calendar secret address in iCal format.') }
  if (url.protocol !== 'https:' || url.hostname !== 'calendar.google.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/calendar\/ical\/[^/]+\/(?:private-[a-zA-Z0-9]+|public)\/basic\.ics$/.test(url.pathname)) throw new Error('Use the HTTPS iCal address from Google Calendar → Settings → Integrate calendar.')
  return url.href
}
function eventView(row: EventRow): CalendarEvent { return { id: row.id, sourceId: row.source_id, calendarName: row.calendar_name, title: row.title, description: row.description, location: row.location, start: row.start, end: row.end, allDay: row.all_day === 1, organizer: row.organizer ? JSON.parse(row.organizer) as CalendarPerson : null, invitees: JSON.parse(row.invitees) as CalendarPerson[], cancelled: row.cancelled === 1, available: row.available === 1 } }

/** Reads Google iCal feeds only; the secret URL never leaves encrypted storage or reaches logs/views. */
export class CalendarService {
  private task: Promise<CalendarState> | null = null
  private controller: AbortController | null = null
  private interval: ReturnType<typeof setInterval> | undefined
  private error: string | null = null
  constructor(private readonly dependencies: Dependencies) {}
  state(): CalendarState {
    const sources = queryAll<SourceRow>('SELECT s.*,(SELECT count(*) FROM calendar_events e WHERE e.source_id=s.id AND e.available=1 AND e.cancelled=0) AS events FROM calendar_sources s ORDER BY s.name,s.id')
    return { syncing: !!this.task, error: this.error, sources: sources.map(row => ({ id: row.id, name: row.name, connected: !!row.ciphertext, lastSyncedAt: row.last_synced_at, events: row.events, error: row.error })) }
  }
  start(): void {
    this.interval = setInterval(() => { if (!this.task && this.dependencies.encryption.isAvailable()) void this.refresh().catch(() => undefined) }, 15 * 60 * 1000)
    if (this.dependencies.encryption.isAvailable() && this.state().sources.some(source => source.connected)) void this.refresh().catch(() => undefined)
  }
  connect(name: string, value: string): Promise<CalendarState> {
    if (!name.trim()) return Promise.reject(new Error('Enter a calendar name.'))
    const url = validateGoogleCalendarLink(value)
    if (!this.dependencies.encryption.isAvailable()) return Promise.reject(new Error('Unlock your operating-system key storage before connecting a private calendar.'))
    const ciphertext = this.dependencies.encryption.encrypt(url), hash = createHash('sha256').update(url).digest('hex')
    return this.perform(async signal => {
      const events = await this.read(url, signal)
      signal.throwIfAborted()
      const id = queryOne<{ id: string }>('SELECT id FROM calendar_sources WHERE feed_hash=?', [hash])?.id ?? randomUUID()
      runInTransaction(() => {
        run('INSERT INTO calendar_sources(id,name,feed_hash,ciphertext,created_at) VALUES (?,?,?,?,?) ON CONFLICT(feed_hash) DO UPDATE SET name=excluded.name,ciphertext=excluded.ciphertext', [id, name.trim(), hash, ciphertext, this.now().toISOString()])
        this.saveEvents(id, events)
      })
    })
  }
  refresh(id?: string): Promise<CalendarState> {
    return this.perform(async signal => {
      const sources = queryAll<SourceRow>(`SELECT * FROM calendar_sources WHERE ciphertext IS NOT NULL${id ? ' AND id=?' : ''}`, id ? [id] : [])
      for (const source of sources) {
        try {
          if (!this.dependencies.encryption.isAvailable()) throw new Error('Reconnect this calendar after unlocking operating-system key storage.')
          let url: string
          try { url = validateGoogleCalendarLink(this.dependencies.encryption.decrypt(source.ciphertext!)) } catch { throw new Error('Reconnect this calendar with its private iCal link.') }
          const events = await this.read(url, signal)
          signal.throwIfAborted(); runInTransaction(() => this.saveEvents(source.id, events))
        } catch (error) {
          signal.throwIfAborted()
          run('UPDATE calendar_sources SET error=? WHERE id=?', [error instanceof CalendarReadError ? error.message : 'Calendar refresh failed. Check the private link and your connection, then retry.', source.id])
        }
      }
    })
  }
  disconnect(id: string): CalendarState {
    if (this.task) throw new Error('Wait for the calendar refresh to finish.')
    run('DELETE FROM calendar_sources WHERE id=?', [id]); this.dependencies.changed(); this.dependencies.libraryChanged(); return this.state()
  }
  forRecording(id: string): RecordingCalendar {
    const recording = queryOne<{ date_recorded: string; duration_seconds: number | null }>('SELECT date_recorded,duration_seconds FROM recordings WHERE id=?', [id])
    if (!recording) throw new Error('Recording was not found.')
    const linked = queryOne<EventRow>(`${EVENT_SELECT} JOIN recording_calendar l ON l.event_id=e.id WHERE l.recording_id=?`, [id])
    const start = Date.parse(recording.date_recorded), end = start + Math.max(0, recording.duration_seconds ?? 0) * 1000
    const candidates = queryAll<EventRow>(`${EVENT_SELECT} WHERE e.available=1 AND e.cancelled=0 AND e.start<=? AND e.end>=? ORDER BY e.start LIMIT 100`, [new Date(end + DAY).toISOString(), new Date(start - DAY).toISOString()])
    const score = (event: EventRow): number => Math.abs(Date.parse(event.start) - start) + (event.all_day ? DAY * 2 : 0)
    return { linked: linked ? eventView(linked) : null, suggestions: candidates.filter(event => event.id !== linked?.id).sort((a, b) => score(a) - score(b)).slice(0, 12).map(eventView) }
  }
  link(recordingId: string, eventId: string | null): void {
    if (!queryOne('SELECT id FROM recordings WHERE id=?', [recordingId])) throw new Error('Recording was not found.')
    if (eventId === null) run('DELETE FROM recording_calendar WHERE recording_id=?', [recordingId])
    else {
      if (!queryOne('SELECT id FROM calendar_events WHERE id=? AND cancelled=0 AND available=1', [eventId])) throw new Error('Choose an available calendar event.')
      run('INSERT INTO recording_calendar(recording_id,event_id) VALUES (?,?) ON CONFLICT(recording_id) DO UPDATE SET event_id=excluded.event_id', [recordingId, eventId])
    }
    this.dependencies.libraryChanged()
  }
  useTitle(id: string): void {
    const event = queryOne<{ title: string }>('SELECT e.title FROM calendar_events e JOIN recording_calendar l ON l.event_id=e.id WHERE l.recording_id=?', [id])
    if (!event) throw new Error('Link a calendar event first.')
    renameRecording(id, event.title.slice(0, 200)); this.dependencies.libraryChanged()
  }
  async stop(): Promise<void> { clearInterval(this.interval); this.controller?.abort(); await this.task?.catch(() => undefined) }
  private perform(operation: (signal: AbortSignal) => Promise<void>): Promise<CalendarState> {
    if (this.task) return Promise.reject(new Error('A calendar refresh is already running.'))
    const controller = new AbortController(); this.controller = controller; this.error = null
    const task = Promise.resolve().then(() => operation(controller.signal)).then(() => this.state())
    this.task = task; this.dependencies.changed()
    void task.catch(() => { if (!controller.signal.aborted) this.error = 'Calendar connection failed. Check the private link and try again.' }).finally(() => { if (this.task === task) { this.task = null; this.controller = null }; this.dependencies.changed() })
    return task.then(state => ({ ...state, syncing: false }))
  }
  private async read(url: string, signal: AbortSignal): Promise<ParsedCalendarEvent[]> {
    try {
      const response = await (this.dependencies.request ?? fetch)(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), redirect: 'error', headers: { Accept: 'text/calendar' } })
      if (!response.ok || !response.body) throw new CalendarReadError('Google Calendar did not return a feed. Check its private iCal address.')
      const reader = response.body.getReader(), parts: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          signal.throwIfAborted()
          const part = await reader.read()
          if (part.done) break
          size += part.value.length
          if (size > 4 * 1024 ** 2) throw new CalendarReadError('The calendar feed exceeds 4 MB. Connect a smaller calendar.')
          parts.push(part.value)
        }
      } finally { await reader.cancel().catch(() => undefined) }
      const dates = queryOne<{ first: string | null; last: string | null }>('SELECT min(date_recorded) AS first,max(date_recorded) AS last FROM recordings')!
      const now = this.now().getTime(), from = Math.min(now - 365 * DAY, dates.first ? Date.parse(dates.first) - 30 * DAY : now), to = Math.max(now + 365 * DAY, dates.last ? Date.parse(dates.last) + 30 * DAY : now)
      return await this.dependencies.parse(Buffer.concat(parts).toString('utf8'), { from: new Date(from).toISOString(), to: new Date(to).toISOString(), timeZone: this.dependencies.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone }, signal)
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof CalendarReadError) throw error
      throw new CalendarReadError('The calendar could not be refreshed. Check the link, dates, and your connection.')
    }
  }
  private saveEvents(id: string, events: ParsedCalendarEvent[]): void {
    run('UPDATE calendar_events SET available=0 WHERE source_id=?', [id])
    for (const event of events) run('INSERT INTO calendar_events(id,source_id,event_key,title,description,location,start,end,all_day,organizer,invitees,cancelled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,event_key) DO UPDATE SET title=excluded.title,description=excluded.description,location=excluded.location,start=excluded.start,end=excluded.end,all_day=excluded.all_day,organizer=excluded.organizer,invitees=excluded.invitees,cancelled=excluded.cancelled,available=1', [randomUUID(), id, event.key, event.title, event.description, event.location, event.start, event.end, Number(event.allDay), event.organizer ? JSON.stringify(event.organizer) : null, JSON.stringify(event.invitees), Number(event.cancelled)])
    run('DELETE FROM calendar_events WHERE source_id=? AND available=0 AND NOT EXISTS(SELECT 1 FROM recording_calendar l WHERE l.event_id=calendar_events.id)', [id])
    run('UPDATE calendar_sources SET last_synced_at=?,error=NULL WHERE id=?', [this.now().toISOString(), id])
  }
  private now(): Date { return this.dependencies.now?.() ?? new Date() }
}
class CalendarReadError extends Error {}
