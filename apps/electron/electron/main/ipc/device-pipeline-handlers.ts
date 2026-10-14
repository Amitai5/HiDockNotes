// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/**
 * DevicePipeline IPC handlers (Slice 4 of the USB Device Pipeline refactor).
 *
 * Bridges the main-process DevicePipelineService to the renderer:
 *  - `device-pipeline:get-state` returns the current projected PipelineState.
 *  - User-action channels (connect/disconnect/sync/cancel/delete/format) delegate
 *    to the single DevicePipelineService instance.
 *  - The service's EventEmitter 'state' / 'files' events are bridged to the renderer.
 */
import { BrowserWindow } from 'electron'
import { getDevicePipelineService, projectDeviceFiles } from '../services/device-pipeline-instance'
import { getDownloadService } from '../services/download-service'
import { handle } from './trusted-ipc'
import { validateFilenames, validateDeviceFilename, validateBoolean } from './jensen-validation'
import { emitActivityLog } from '../services/activity-log'
import type { PipelinePhase, PipelineState } from '../types/device-pipeline'

export function registerDevicePipelineHandlers(): void {
  const pipeline = getDevicePipelineService()
  const broadcast = (channel: string, payload: unknown): void => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(channel, payload) }
  let previousPhase = pipeline.getState().phase
  const messages: Record<PipelinePhase, string> = { disconnected: 'Recorder disconnected.', connecting: 'Connecting to the recorder…', initializing: 'Reading recorder information…', scanning: 'Reading the recorder file list…', reconciling: 'Checking which recordings are already downloaded…', downloading: 'Downloading completed recordings…', idle: 'Recorder is ready.', error: 'Recorder operation failed.' }
  pipeline.on('state', (state: PipelineState) => {
    broadcast('device-pipeline:state', state)
    if (state.phase !== previousPhase) { previousPhase = state.phase; emitActivityLog(state.phase === 'error' ? 'error' : 'info', state.phase === 'error' ? state.error ?? messages.error : messages[state.phase]) }
  })
  pipeline.on('files', () => broadcast('device-pipeline:files', projectDeviceFiles()))
  handle('device-pipeline:get-state', () => pipeline.getState())
  handle('device-pipeline:get-files', () => projectDeviceFiles())
  handle('device-pipeline:connect', () => pipeline.connect())
  handle('device-pipeline:disconnect', () => pipeline.disconnect())
  handle('device-pipeline:sync', () => pipeline.manualSync())
  handle('device-pipeline:cancel', () => pipeline.cancelDownloads())
  handle('device-pipeline:download', filenames => pipeline.downloadSelected(validateFilenames(filenames)))
  handle('device-pipeline:delete', async (filename, confirmed) => {
    if (confirmed !== true) throw new Error('Deletion requires explicit confirmation.')
    const result = await pipeline.deleteFile(validateDeviceFilename(filename))
    if (result?.result !== 'success') throw new Error('The device did not confirm deletion.')
    emitActivityLog('success', 'Recording deleted from the device after local verification.')
    await pipeline.manualSync()
    return result
  })
  handle('device-pipeline:sync-time', () => pipeline.syncTime())
  handle('device-pipeline:auto-record', async enabled => {
    const result = await pipeline.setAutoRecord(validateBoolean(enabled))
    if (result?.result !== 'success') throw new Error('Could not change auto-record.')
  })
  handle('download-service:get-state', () => getDownloadService().getState())
}
