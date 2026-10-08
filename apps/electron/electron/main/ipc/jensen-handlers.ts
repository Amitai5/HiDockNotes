// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Jensen IPC handlers. The application coordinator owns every USB command. */
import { getDevicePipelineService } from '../services/device-pipeline-instance'
let recordingPoll: ReturnType<typeof setInterval> | undefined

// The reference polls only after scanning and only when the bus is idle.
// Refresh checks recording state first, then reconciles newly completed files.
export function startRecordingPoll(): void {
  if (recordingPoll) return
  recordingPoll = setInterval(() => {
    const pipeline = getDevicePipelineService()
    if (pipeline.getState().phase === 'idle') void pipeline.pollForNewRecordings().catch(() => undefined)
  }, 20000)
  recordingPoll.unref()
}
export function stopRecordingPoll(): void { if (recordingPoll) clearInterval(recordingPoll); recordingPoll = undefined }
export function getActiveDeviceRecording(): string | null | undefined { return getDevicePipelineService().getActiveRecording() }
