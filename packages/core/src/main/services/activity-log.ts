import { randomUUID } from 'node:crypto'
import type { ActivityEntry } from '../../../src/shared/contracts'
const entries: ActivityEntry[] = []
let publish: (name: string, value?: unknown) => void = () => undefined
export function configureActivityLog(sink: typeof publish): void { publish = sink }
export function getActivityLog(): ActivityEntry[] { return [...entries] }
export function clearActivityLog(): void { entries.length = 0; publish('activity-log:cleared') }
export type ActivityLogType = 'error' | 'success' | 'info' | 'warning' | 'usb-in' | 'usb-out'
export function emitActivityLog(type: ActivityLogType, message: string, details?: string): void {
  const entry: ActivityEntry = { id: randomUUID(), type: type === 'usb-in' || type === 'usb-out' ? 'info' : type, category: type.startsWith('usb-') ? 'Device' : 'App', message, details, timestamp: new Date().toISOString() }
  entries.push(entry); if (entries.length > 200) entries.shift(); publish('activity-log:entry', entry)
}
