// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/**
 * Activity Log Bridge — main process to renderer IPC
 *
 * Main process services (transcription, calendar-sync, download-service) run
 * isolated from the renderer's HiDockDeviceService. They cannot call
 * deviceService.logActivity() directly. This module provides a lightweight
 * IPC bridge that emits activity log entries to the renderer window.
 *
 * Usage:
 *   import { emitActivityLog } from './activity-log'
 *   emitActivityLog('info', 'Syncing calendar...', 'Fetching from ICS URL')
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { ActivityEntry } from '../../../src/shared/contracts'
const entries: ActivityEntry[] = []

export function getActivityLog(): ActivityEntry[] { return [...entries] }
export function clearActivityLog(): void {
  entries.length = 0
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('activity-log:cleared')
  }
}

export type ActivityLogType = 'error' | 'success' | 'info' | 'warning' | 'usb-in' | 'usb-out'

export interface ActivityLogEntry {
  type: ActivityLogType
  message: string
  details?: string
  timestamp: Date
}

/**
 * Emit an activity log entry to the renderer window.
 * Fire-and-forget — safe to call from anywhere in the main process.
 */
export function emitActivityLog(
  type: ActivityLogType,
  message: string,
  details?: string
): void {
  const entry: ActivityEntry = {
    id: randomUUID(),
    type: type === 'usb-in' || type === 'usb-out' ? 'info' : type,
    category: type.startsWith('usb-') ? 'Device' : 'App',
    message,
    details,
    timestamp: new Date().toISOString()
  }
  entries.push(entry)
  if (entries.length > 200) entries.splice(0, entries.length - 200)

  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('activity-log:entry', entry)
    }
  }
}
