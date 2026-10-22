import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarService, validateGoogleCalendarLink } from '../calendar/calendar-service'
import { parseCalendarFeed } from '../calendar/calendar-parser'
import { closeDatabase, getDetail, initializeDatabase, queryAll, queryOne, run, upsertRecordingFromDevice } from '../services/database'

const url = 'https://calendar.google.com/calendar/ical/example%40example.test/private-0123456789abcdef0123456789abcdef/basic.ics'
const date = '2026-10-21T17:00:00.000Z'
const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting\r\nDTSTART:20261021T170000Z\r\nDTEND:20261021T180000Z\r\nSUMMARY:Intake planning\r\nORGANIZER;CN=Dana:mailto:dana@example.test\r\nATTENDEE;CN=Alex:mailto:alex@example.test\r\nEND:VEVENT\r\nEND:VCALENDAR'
let service: CalendarService, id: string
const request = vi.fn(), changed = vi.fn(), libraryChanged = vi.fn()
beforeEach(() => {
  initializeDatabase(':memory:'); request.mockReset().mockImplementation(async () => new Response(text)); changed.mockReset(); libraryChanged.mockReset()
  id = upsertRecordingFromDevice({ filename: 'meeting.hda', size: 2, duration: 1800, dateCreated: new Date(date) }).id
  service = new CalendarService({ request, encryption: { isAvailable: () => true, encrypt: value => Buffer.from(value).reverse(), decrypt: value => Buffer.from(value).reverse().toString() }, parse: async (source, window) => parseCalendarFeed(source, window), changed, libraryChanged, now: () => new Date(date), timeZone: 'America/Los_Angeles' })
})
afterEach(async () => { await service.stop(); closeDatabase() })
describe('private Google Calendar feeds', () => {
  it.each(['http://calendar.google.com/calendar/ical/x/public/basic.ics', 'https://calendar.google.com.evil.test/calendar/ical/x/public/basic.ics', 'https://calendar.google.com@127.0.0.1/calendar/ical/x/public/basic.ics', 'https://calendar.google.com/calendar/ical/x/public/basic.ics?secret=other', 'https://127.0.0.1/calendar.ics'])('rejects unsupported feed URLs: %s', value => { expect(() => validateGoogleCalendarLink(value)).toThrow() })
  it('stores the secret encrypted, never exposes it in views, and reuses a reconnected source', async () => {
    const state = await service.connect('Work', url), source = state.sources[0]
    expect(source).toMatchObject({ name: 'Work', connected: true, events: 1 })
    expect(JSON.stringify(state)).not.toContain('private-')
    expect(queryOne<{ ciphertext: Buffer }>('SELECT ciphertext FROM calendar_sources')!.ciphertext.toString()).not.toContain(url)
    await service.connect('Work renamed', url)
    expect(service.state().sources).toHaveLength(1); expect(service.state().sources[0].id).toBe(source.id)
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
  })
  it('suggests a nearby event but changes neither the title nor actual participants until selected', async () => {
    await service.connect('Work', url)
    const suggestions = service.forRecording(id)
    expect(suggestions.linked).toBeNull(); expect(suggestions.suggestions[0].title).toBe('Intake planning')
    service.link(id, suggestions.suggestions[0].id)
    expect(getDetail(id)).toMatchObject({ recording: { title: null }, meeting: null, speakers: [] })
    service.useTitle(id)
    expect(getDetail(id).recording.title).toBe('Intake planning')
    expect(queryOne('SELECT title_source FROM recordings WHERE id=?', [id])).toEqual({ title_source: 'manual' })
  })
  it('keeps cached events on refresh failure and does not leak the secret from a network error', async () => {
    await service.connect('Work', url)
    request.mockRejectedValueOnce(new Error('Could not fetch ' + url))
    const state = await service.refresh()
    expect(state.sources[0].error).toContain('could not be refreshed')
    expect(JSON.stringify(state)).not.toContain('private-')
    expect(service.forRecording(id).suggestions).toHaveLength(1)
  })
  it('updates a linked event in place and preserves its last details if it disappears from a feed', async () => {
    await service.connect('Work', url)
    const eventId = service.forRecording(id).suggestions[0].id
    service.link(id, eventId)
    request.mockResolvedValueOnce(new Response(text.replace('Intake planning', 'Updated agenda')))
    await service.refresh()
    expect(service.forRecording(id).linked).toMatchObject({ id: eventId, title: 'Updated agenda', available: true })
    request.mockResolvedValueOnce(new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR'))
    await service.refresh()
    expect(service.forRecording(id).linked).toMatchObject({ id: eventId, available: false, cancelled: false })
    expect(service.forRecording(id).suggestions).toEqual([])
  })
  it('removes the calendar secret, cache, and links without deleting recordings or meeting notes', async () => {
    const state = await service.connect('Work', url)
    service.link(id, service.forRecording(id).suggestions[0].id)
    service.disconnect(state.sources[0].id)
    expect(queryAll('SELECT * FROM calendar_events')).toEqual([]); expect(queryAll('SELECT * FROM recording_calendar')).toEqual([])
    expect(getDetail(id).recording.id).toBe(id)
  })
  it('refuses to store private links when operating-system encryption is unavailable', async () => {
    const locked = new CalendarService({ encryption: { isAvailable: () => false, encrypt: vi.fn(), decrypt: vi.fn() }, parse: vi.fn(), changed, libraryChanged, request })
    await expect(locked.connect('Work', url)).rejects.toThrow('key storage')
    expect(request).not.toHaveBeenCalled(); expect(queryAll('SELECT * FROM calendar_sources')).toEqual([])
  })
  it('does not offer cancelled or distant events as matches', async () => {
    await service.connect('Work', url)
    run('UPDATE calendar_events SET cancelled=1')
    expect(service.forRecording(id).suggestions).toEqual([])
    run("UPDATE calendar_events SET cancelled=0,start='2026-12-01T17:00:00.000Z',end='2026-12-01T18:00:00.000Z'")
    expect(service.forRecording(id).suggestions).toEqual([])
  })
})
