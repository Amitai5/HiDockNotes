// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Device service facade and bounded activity buffer. Hardware stays in the main process. */
import { JensenIpcClient } from './jensen-ipc-client'
import type { ActivityEntry, Unsubscribe } from '../shared/contracts'

export class HiDockDeviceService extends JensenIpcClient {
  private readonly activityLog: ActivityEntry[] = []
  private readonly listeners = new Set<(entry: ActivityEntry) => void>()
  private activityGeneration = 0
  acceptActivity(entry: ActivityEntry): void {
    if (this.activityLog.some(e => e.id === entry.id)) return
    this.activityLog.push(entry)
    if (this.activityLog.length > 200) this.activityLog.splice(0, this.activityLog.length - 200)
    for (const callback of this.listeners) callback(entry)
  }
  getActivityLog(): ActivityEntry[] { return [...this.activityLog] }
  clearActivityLog(): void { this.activityLog.length = 0; this.activityGeneration++ }
  getActivityGeneration(): number { return this.activityGeneration }
  onActivity(callback: (entry: ActivityEntry) => void): Unsubscribe {
    this.listeners.add(callback)
    for (const entry of this.activityLog) callback(entry)
    return () => this.listeners.delete(callback)
  }
}
const service = new HiDockDeviceService()
export function getHiDockDeviceService(): HiDockDeviceService { return service }
