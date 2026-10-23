import { appClient } from '../services/app-client'
// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).


/**
 * A terminal download that needs attention in the Operations UI. This includes
 * genuine failures plus disconnect-interrupted cancellations, but excludes a
 * deliberate user cancel.
 */
export function isRetryableDownloadItem(item: { status: string; cancelReason?: string }): boolean {
  if (item.status === 'failed') return true
  if (item.status === 'cancelled') return item.cancelReason !== 'user'
  return false
}


/**
 * A download that may be retried automatically on reconnect. Only a transfer
 * explicitly interrupted by disconnection is safe to repeat. A genuine USB
 * failure/stall must remain failed until a manual retry; otherwise one bad file
 * disconnects the device and restarts forever on every reconnect.
 */
export function isReconnectRetryableDownloadItem(item: { status: string; cancelReason?: string }): boolean {
  return item.status === 'cancelled' && item.cancelReason !== 'user'
}


export function selectDownloadsToProcess<T extends { filename: string }>(
  pending: T[],
  requested: Set<string>,
  autoDownload: boolean
): T[] {
  return autoDownload ? pending : pending.filter((p) => requested.has(p.filename))
}


export interface OrderableDownload {
  filename: string
  recordingDate?: Date | string | null
}


/**
 * Recency-first download ordering. Pure + deterministic so the dequeue loop can
 * re-run it on every iteration (mirrors transcription.ts orderPendingForProcessing):
 *
 *   1. User-explicit single downloads first, FIFO among themselves.
 *   2. Everything else by the recording's content date (recordingDate) DESC, so
 *      today's recording beats last month's regardless of enqueue order. Undated
 *      recordings sort last. Tiebreak: original (enqueue) order = FIFO.
 *
 * Because it re-runs per dequeue, a newer file detected mid-backlog preempts the
 * older waiting items automatically. Relies on Array.prototype.sort being stable
 * (ES2019+) for the FIFO tiebreaks.
 */
export function orderDownloadsForProcessing<T extends OrderableDownload>(
  pending: T[],
  priority: Set<string>
): T[] {
  const ms = (v?: Date | string | null): number => {
    if (!v) return Number.NEGATIVE_INFINITY // undated → smallest → sorts last under DESC
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
  }
  return [...pending].sort((a, b) => {
    const aPri = priority.has(a.filename) ? 0 : 1
    const bPri = priority.has(b.filename) ? 0 : 1
    if (aPri !== bPri) return aPri - bPri
    if (aPri === 0) return 0 // both user-explicit → FIFO (stable sort keeps input order)
    const da = ms(a.recordingDate)
    const db = ms(b.recordingDate)
    if (da !== db) return db - da // recordingDate DESC (newest first)
    return 0 // FIFO tiebreak (stable sort)
  })
}


/**
 * Hard connectivity gate for STARTING a download session. A download must NEVER
 * touch the USB bus unless the device is genuinely connected AND past initialization
 * (step === 'ready'). Queuing while disconnected must persist the item as pending and
 * start nothing — processing then resumes automatically on connect (drainDownloadQueue).
 *
 * Both conditions are required:
 *  - isConnected() alone is insufficient: it can read true during early init steps
 *    before the device is usable (see DL-001).
 *  - step === 'ready' alone is insufficient: the store step can be stale after an
 *    undetected unplug, which is exactly how a "download" went active against a
 *    disconnected device and starved the app.
 */
export function canStartDownloadSession(isConnected: boolean, connectionStep: string): boolean {
  return isConnected && connectionStep === 'ready'
}

export function useDownloadOrchestrator() {
  return { download: (filenames: string[]) => appClient.devicePipeline.download(filenames), cancel: () => appClient.devicePipeline.cancel() }
}
