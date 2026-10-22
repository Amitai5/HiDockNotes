import type { CalendarService } from '../calendar/calendar-service'
import { handle } from './trusted-ipc'
import { validateBoolean, validateId, validateText } from './jensen-validation'

export function registerCalendarHandlers(service: CalendarService, openSettings: () => Promise<void>): void {
  handle('calendar:open-settings', openSettings)
  handle('calendar:state', () => service.state())
  handle('calendar:connect', (name, url) => service.connect(validateText(name, 100), validateText(url, 2000)))
  handle('calendar:refresh', id => service.refresh(id === undefined ? undefined : validateId(id)))
  handle('calendar:disconnect', (id, confirmed) => { if (!validateBoolean(confirmed)) throw new Error('Confirm before removing this calendar.'); return service.disconnect(validateId(id)) })
  handle('calendar:recording', id => service.forRecording(validateId(id)))
  handle('calendar:link', (id, event) => service.link(validateId(id), event === null ? null : validateId(event)))
  handle('calendar:use-title', id => service.useTitle(validateId(id)))
}
