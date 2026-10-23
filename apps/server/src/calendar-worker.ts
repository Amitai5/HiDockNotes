const sendToParent = (message: unknown): void => { process.send?.(message) }
import { parseCalendarFeed, type CalendarWindow } from '@hidock/core/calendar/calendar-parser'

process.on('message', (data: { text: string; window: CalendarWindow }) => {
  try { sendToParent({ events: parseCalendarFeed(data.text, data.window) }) }
  catch { sendToParent({ error: 'The calendar feed could not be read. Check its dates and time zones, or try a smaller calendar.' }) }
})
