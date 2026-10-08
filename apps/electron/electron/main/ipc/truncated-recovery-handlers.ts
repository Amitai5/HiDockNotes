// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** IPC for safely recovering truncated local recordings from the device. */
import { planTruncatedRecovery, queueTruncatedRecovery } from '../services/truncated-recovery'
import { getActiveDeviceRecording } from './jensen-handlers'
import { handle } from './trusted-ipc'

export function registerTruncatedRecoveryHandlers(): void {
  handle('truncated-recovery:plan', () => {
    const plan = planTruncatedRecovery(getActiveDeviceRecording())
    return { ...plan, recoverable: plan.recoverable.map(r => ({ recordingId: r.recordingId, deviceFilename: r.deviceFilename, deviceBytes: r.deviceBytes, localBytes: r.localBytes })) }
  })
  handle('truncated-recovery:queue', () => {
    const result = queueTruncatedRecovery(getActiveDeviceRecording())
    return { queued: result.queued, skipped: result.skipped }
  })
}
