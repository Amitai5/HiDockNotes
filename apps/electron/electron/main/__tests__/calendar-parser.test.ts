import { describe, expect, it } from 'vitest'
import { parseCalendarFeed } from '../calendar/calendar-parser'

const window = { from: '2026-10-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z', timeZone: 'America/Los_Angeles' }
const feed = (events: string): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-TIMEZONE:America/Los_Angeles\r\n${events}\r\nEND:VCALENDAR\r\n`
describe('bounded Google iCalendar event parsing', () => {
  it('reads titles, agendas, organizers and invitees without inventing attendance', () => {
    const result = parseCalendarFeed(feed('BEGIN:VEVENT\r\nUID:meeting\r\nDTSTART:20261021T170000Z\r\nDTEND:20261021T180000Z\r\nSUMMARY:Intake planning\r\nDESCRIPTION:Review forms\\nAgree next steps\r\nORGANIZER;CN=Dana Lee:mailto:dana@example.test\r\nATTENDEE;CN=Alex Rivera:mailto:alex@example.test\r\nLOCATION:Video call\r\nEND:VEVENT'), window)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ title: 'Intake planning', start: '2026-10-21T17:00:00.000Z', end: '2026-10-21T18:00:00.000Z', description: 'Review forms\nAgree next steps', organizer: { name: 'Dana Lee', email: 'dana@example.test' }, invitees: [{ name: 'Alex Rivera', email: 'alex@example.test' }], cancelled: false })
  })
  it('converts repeating IANA-zone events across daylight saving and honors exclusions and overrides', () => {
    const result = parseCalendarFeed(feed('BEGIN:VEVENT\r\nUID:weekly\r\nDTSTART;TZID=America/Los_Angeles:20261025T100000\r\nDTEND;TZID=America/Los_Angeles:20261025T110000\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\nEXDATE;TZID=America/Los_Angeles:20261108T100000\r\nSUMMARY:Weekly review\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID;TZID=America/Los_Angeles:20261115T100000\r\nDTSTART;TZID=America/Los_Angeles:20261115T120000\r\nDTEND;TZID=America/Los_Angeles:20261115T130000\r\nSUMMARY:Moved review\r\nEND:VEVENT'), window)
    expect(result.map(event => event.start)).toEqual(['2026-10-25T17:00:00.000Z', '2026-11-01T18:00:00.000Z', '2026-11-15T20:00:00.000Z'])
    expect(result[2].title).toBe('Moved review')
  })
  it('keeps all-day dates and cancelled events distinct from timed meetings', () => {
    const events = parseCalendarFeed(feed('BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20261021\r\nDTEND;VALUE=DATE:20261022\r\nSUMMARY:Conference\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:cancelled\r\nDTSTART:20261021T170000Z\r\nDTEND:20261021T180000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:Cancelled review\r\nEND:VEVENT'), window)
    expect(events[0]).toMatchObject({ allDay: true, start: '2026-10-21T00:00:00.000Z', end: '2026-10-22T00:00:00.000Z' })
    expect(events[1].cancelled).toBe(true)
  })
  it('rejects nonexistent local times rather than linking to the wrong hour', () => {
    expect(() => parseCalendarFeed(feed('BEGIN:VEVENT\r\nUID:gap\r\nDTSTART;TZID=America/Los_Angeles:20260308T023000\r\nDTEND;TZID=America/Los_Angeles:20260308T033000\r\nSUMMARY:Invalid gap\r\nEND:VEVENT'), { ...window, from: '2026-03-01T00:00:00.000Z' })).toThrow('nonexistent')
  })
  it('rejects unsupported input and bounds unending recurrence expansion', () => {
    expect(() => parseCalendarFeed('<html>Sign in</html>', window)).toThrow('valid calendar')
    expect(() => parseCalendarFeed(feed('BEGIN:VEVENT\r\nUID:loop\r\nDTSTART:20261001T000000Z\r\nDTEND:20261001T000001Z\r\nRRULE:FREQ=SECONDLY\r\nSUMMARY:Too many\r\nEND:VEVENT'), window)).toThrow('too many')
  })
})
