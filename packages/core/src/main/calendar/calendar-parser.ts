import ICAL from 'ical.js'
import type { CalendarPerson } from '../../../src/shared/calendar'

export interface ParsedCalendarEvent { key: string; title: string; description: string; location: string; start: string; end: string; allDay: boolean; organizer: CalendarPerson | null; invitees: CalendarPerson[]; cancelled: boolean }
export interface CalendarWindow { from: string; to: string; timeZone: string }
type CalendarTime = InstanceType<typeof ICAL.Time>
type CalendarComponent = InstanceType<typeof ICAL.Component>
type CalendarProperty = InstanceType<typeof ICAL.Property>
const text = (value: unknown, maximum: number): string => typeof value === 'string' ? value.slice(0, maximum).trim() : ''

function person(property: CalendarProperty | null): CalendarPerson | null {
  if (!property) return null
  const raw = text(property.getFirstValue(), 400)
  const email = /^mailto:/i.test(raw) ? raw.slice(7) : ''
  const name = text(property.getParameter('cn'), 200)
  return name || email ? { name: name || null, email: /^[^\s@]+@[^\s@]+$/.test(email) ? email : null } : null
}
function wallTime(time: CalendarTime, zone: string): string {
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second)
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  let instant = wall
  for (let index = 0; index < 4; index++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, Number(part.value)]))
    const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    const difference = wall - shown
    if (!difference) return new Date(instant).toISOString()
    instant += difference
  }
  throw new Error('A calendar event uses a nonexistent local time. Correct it in Google Calendar and refresh.')
}
function date(time: CalendarTime, component: CalendarComponent, property: 'dtstart' | 'dtend', fallback: string): string {
  if (time.isDate) return new Date(Date.UTC(time.year, time.month - 1, time.day)).toISOString()
  if (time.zone.tzid !== 'floating') return new Date(time.toUnixTime() * 1000).toISOString()
  const zone = component.getFirstProperty(property)?.getParameter('tzid')
  return wallTime(time, typeof zone === 'string' ? zone : fallback)
}
/** Parses recurrence rules and exceptions inside a short-lived, time-limited worker. */
export function parseCalendarFeed(source: string, window: CalendarWindow): ParsedCalendarEvent[] {
  if (Buffer.byteLength(source) > 4 * 1024 ** 2 || !source.trimStart().startsWith('BEGIN:VCALENDAR')) throw new Error('Choose a valid calendar feed smaller than 4 MB.')
  ICAL.TimezoneService.reset()
  const calendar = new ICAL.Component(ICAL.parse(source))
  if (calendar.name !== 'vcalendar') throw new Error('The response is not an iCalendar calendar.')
  for (const zone of calendar.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(zone)
  const components = calendar.getAllSubcomponents('vevent')
  if (components.length > 10000) throw new Error('This calendar contains too many events. Use a smaller calendar.')
  const fallback = text(calendar.getFirstPropertyValue('x-wr-timezone'), 100) || window.timeZone
  const result: ParsedCalendarEvent[] = [], keys = new Set<string>()
  let iterations = 0
  for (const component of components) {
    const event = new ICAL.Event(component)
    if (event.isRecurrenceException() && components.some(other => other !== component && !other.hasProperty('recurrence-id') && other.getFirstPropertyValue('uid') === event.uid)) continue
    if (!event.uid || !component.hasProperty('dtstart')) continue
    const iterator = event.iterator()
    for (;;) {
      if (++iterations > 40000) throw new Error('This calendar expands to too many occurrences. Use a smaller calendar.')
      const occurrence = iterator.next()
      if (!occurrence) break
      const details = event.getOccurrenceDetails(occurrence), item = details.item, actual = item.component
      const start = date(details.startDate, actual, 'dtstart', fallback), end = date(details.endDate, actual, 'dtend', fallback)
      if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || end < start) throw new Error('A calendar event has invalid dates.')
      if (start > window.to && event.isRecurring()) break
      if (end >= window.from && start <= window.to) {
        const key = event.uid.slice(0, 1000) + '|' + (event.isRecurring() ? occurrence.toString() : event.recurrenceId?.toString() ?? '')
        if (!keys.has(key)) {
          keys.add(key)
          result.push({ key, title: text(item.summary, 500) || 'Untitled event', description: text(item.description, 12000), location: text(item.location, 1000), start, end, allDay: details.startDate.isDate, organizer: person(actual.getFirstProperty('organizer')), invitees: actual.getAllProperties('attendee').slice(0, 100).map(person).filter((value): value is CalendarPerson => value !== null), cancelled: String(actual.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED' })
        }
        if (result.length > 8000) throw new Error('This calendar contains too many matching events. Use a smaller calendar.')
      }
      if (!event.isRecurring()) break
    }
  }
  return result
}
