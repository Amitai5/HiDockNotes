// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/**
 * Real-singleton wiring for DevicePipelineService.
 *
 * Kept separate from device-pipeline.ts so the class stays importable in unit
 * tests without pulling in the Electron / native-USB module graph. Critically,
 * this uses STATIC imports: a lazy `require('./jensen')` does NOT resolve in the
 * electron-vite-bundled main process (everything is bundled into one file, so
 * the relative path doesn't exist at runtime) — which crashed startup with
 * "Cannot find module './jensen'".
 */
import {
  DevicePipelineService,
  type PipelineJensen,
  type PipelineDownloadService,
} from './device-pipeline'
import { getJensenDevice } from './jensen'
import { webusb, USB_VENDOR_IDS } from './jensen'
import { getDownloadService } from './download-service'
import { getConfig } from './config'
import { getRecordingByFilename, queryOne, run, runInTransaction } from './database'
import { serializeDeviceOperation } from './device-operation-serializer'
import { trackActiveTransfer } from './download-transfer-controller'
import { hasVerifiedCopy, verifySavedFile, verifyDownloadedBytes } from './file-verification'
import { emitActivityLog } from './activity-log'
import { statSync } from 'node:fs'
import { recordingReady } from './recording-events'
import type { FileInfo } from '@hidock/jensen-protocol'

let pipelineInstance: DevicePipelineService | null = null

export function getDevicePipelineService(): DevicePipelineService {
  if (!pipelineInstance) {
    const raw = getJensenDevice()
    const downloads = getDownloadService()
    downloads.setFileVerifier(verifyDownloadedBytes)
    // Every command and its asynchronous drain occupy the SAME serializer.
    // No application command can pass a cancelled stream still being absorbed.
    const adapter: PipelineJensen = {
      connect: signal => serializeDeviceOperation(() => raw.isConnected() ? Promise.resolve(true) : raw.connect(signal)),
      tryConnect: () => serializeDeviceOperation(() => raw.tryConnect()),
      disconnect: () => serializeDeviceOperation(() => raw.disconnect()),
      isConnected: () => raw.isConnected(),
      getModel: () => raw.getModel(),
      get serialNumber() { return raw.serialNumber },
      get versionCode() { return raw.versionCode },
      getDeviceInfo: () => serializeDeviceOperation(() => raw.getDeviceInfo()),
      getCardInfo: () => serializeDeviceOperation(() => raw.getCardInfo()),
      getFileCount: () => serializeDeviceOperation(() => raw.getFileCount()),
      getSettings: () => serializeDeviceOperation(() => raw.getSettings()),
      getTime: () => serializeDeviceOperation(() => raw.getTime()),
      getBatteryStatus: () => serializeDeviceOperation(() => raw.getBatteryStatus()),
      getRecordingFile: () => serializeDeviceOperation(() => raw.getRecordingFile()),
      setTime: date => serializeDeviceOperation(() => raw.setTime(date)),
      setAutoRecord: enabled => serializeDeviceOperation(() => raw.setAutoRecord(enabled)),
      listFiles: (progress, count, newFiles) => serializeDeviceOperation(() => raw.listFiles(progress, count, newFiles)),
      downloadFile: (filename, size, chunk, progress, signal) => {
        const abort = new AbortController()
        const onAbort = () => abort.abort('user-cancel')
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
        return trackActiveTransfer(filename, abort, () => serializeDeviceOperation(async () => {
          try { return await raw.downloadFile(filename, size, chunk, progress, abort.signal) }
          finally { await raw.getActiveDownloadSettlement() }
        })).finally(() => signal?.removeEventListener('abort', onAbort))
      },
      deleteFile: filename => serializeDeviceOperation(async () => {
        const current = await raw.getRecordingFile()
        if (!current || current.recording === filename) throw new Error('Cannot delete while recording state is unknown or this file is being recorded.')
        const files = await raw.listFiles()
        const file = files?.find(f => f.name === filename)
        if (!file || !await hasVerifiedCopy(filename, file.length, raw.serialNumber)) throw new Error('Local verification failed. Download and verify the recording first.')
        return raw.deleteFile(filename)
      })
    }
    const downloadAdapter: PipelineDownloadService = {
      getFilesToSyncBatched: async files => {
        const reconciled = await downloads.getFilesToSyncBatched(files)
        return reconciled.map(file => {
          const rec = getRecordingByFilename(file.filename)
          if (rec?.file_path) {
            try { if (statSync(rec.file_path).size < file.size) return { ...file, skipReason: undefined } }
            catch { /* copied reconciliation handles missing files */ }
          }
          return file
        })
      },
      processDownload: (name, bytes) => downloads.processDownload(name, bytes),
      cancelActiveDownloads: (reason, origin) => downloads.cancelActiveDownloads(reason, origin),
      queueDownloads: (files, explicit) => downloads.queueDownloads(files, explicit),
      getState: () => downloads.getState(),
      updateProgress: (name, bytes) => downloads.updateProgress(name, bytes),
      markFailed: (name, reason) => downloads.markFailed(name, reason)
    }
    pipelineInstance = new DevicePipelineService(
      adapter,
      downloadAdapter,
      {
        getConfig,
        onError: message => emitActivityLog('error', message),
        verifyDownload: async (filename, path) => {
          await verifySavedFile(filename, path, raw.serialNumber)
          const saved = getRecordingByFilename(filename)
          if (saved) recordingReady(saved.id)
          emitActivityLog('success', `Downloaded and verified ${filename}`)
          const { BrowserWindow } = await import('electron')
          for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('library:changed')
        },
        canDelete: async filename => {
          const file = pipelineInstance?.getFiles().find(f => f.name === filename)
          return !!file && await hasVerifiedCopy(filename, file.length, raw.serialNumber)
        },
        replacementFor: (filename, size) => {
          const rec = getRecordingByFilename(filename)
          if (!rec?.file_path) return undefined
          try { return statSync(rec.file_path).size < size ? { path: rec.file_path, recordingId: rec.id } : undefined }
          catch { return undefined }
        },
        onScan: (files: FileInfo[]) => runInTransaction(() => {
          run('DELETE FROM device_file_cache')
          for (const file of files) run('INSERT INTO device_file_cache(filename, size, dateCreated, duration) VALUES (?, ?, ?, ?)', [file.name, file.length, file.time?.toISOString() ?? null, file.duration])
        }),
        usbEvents: webusb,
        isHiDockDevice: d => USB_VENDOR_IDS.includes((d as USBDevice).vendorId)
      }
    )
    raw.ondisconnect = () => pipelineInstance?.notifyDisconnected()
    raw.onconnect = () => {
      if (pipelineInstance?.getState().phase === 'disconnected') void pipelineInstance.connect().catch(error => emitActivityLog('error', error instanceof Error ? error.message : 'Could not reconnect.'))
    }
    raw.onrecoveryexhausted = () => emitActivityLog('error', 'Safe USB recovery could not restore the connection. Reconnect your recorder.')
  }
  return pipelineInstance
}

export function projectDeviceFiles(): Array<FileInfo & { localVerified: boolean; active: boolean }> {
  const pipeline = getDevicePipelineService()
  const files = pipeline.getFiles()
  const recording = pipeline.getActiveRecording()
  const newest = [...files].sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0))[0]?.name
  return files.map(f => {
    const rec = queryOne<{ verified: number; file_path: string; file_size: number; device_serial: string }>('SELECT verified, file_path, file_size, device_serial FROM recordings WHERE filename=?', [f.name])
    let present = false
    try { present = !!rec?.file_path && statSync(rec.file_path).size === f.length } catch { /* offline folder */ }
    return { ...f, active: f.name === recording || (recording !== null && f.name === newest), localVerified: present && rec?.verified === 1 && rec.file_size === f.length && rec.device_serial === getJensenDevice().serialNumber }
  })
}

/** Test-only: reset the singleton between suites. */
export function __resetDevicePipelineServiceForTests(): void {
  pipelineInstance = null
}
