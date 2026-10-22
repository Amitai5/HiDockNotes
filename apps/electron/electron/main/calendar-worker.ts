import { parseCalendarFeed, type CalendarWindow } from './calendar/calendar-parser'

process.parentPort.on('message', (event: { data: { text: string; window: CalendarWindow } }) => {
  try { process.parentPort.postMessage({ events: parseCalendarFeed(event.data.text, event.data.window) }) }
  catch { process.parentPort.postMessage({ error: 'The calendar feed could not be read. Check its dates and time zones, or try a smaller calendar.' }) }
})
