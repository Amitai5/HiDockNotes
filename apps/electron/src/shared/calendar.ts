export interface CalendarSource { id: string; name: string; connected: boolean; lastSyncedAt: string | null; events: number; error: string | null }
export interface CalendarPerson { name: string | null; email: string | null }
export interface CalendarEvent {
  id: string; sourceId: string; calendarName: string; title: string; description: string; location: string
  start: string; end: string; allDay: boolean; organizer: CalendarPerson | null; invitees: CalendarPerson[]; cancelled: boolean; available: boolean
}
export interface RecordingCalendar { linked: CalendarEvent | null; suggestions: CalendarEvent[] }
export interface CalendarState { sources: CalendarSource[]; syncing: boolean; error: string | null }
