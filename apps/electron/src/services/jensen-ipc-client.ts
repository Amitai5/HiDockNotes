// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Jensen IPC client: a projection and scoped actions, with no renderer USB or filesystem. */
import type { PipelineState } from '../../electron/main/types/device-pipeline'
import type { DeviceFile, Unsubscribe } from '../shared/contracts'

export class JensenIpcClient {
  getState(): Promise<PipelineState> { return window.electronAPI.devicePipeline.getState() }
  listFiles(): Promise<DeviceFile[]> { return window.electronAPI.devicePipeline.getFiles() }
  connect(): Promise<boolean> { return window.electronAPI.devicePipeline.connect() }
  disconnect(): Promise<void> { return window.electronAPI.devicePipeline.disconnect() }
  downloadFiles(filenames: string[]): Promise<void> { return window.electronAPI.devicePipeline.download(filenames) }
  cancelDownloads(): Promise<void> { return window.electronAPI.devicePipeline.cancel() }
  onState(callback: (state: PipelineState) => void): Unsubscribe { return window.electronAPI.devicePipeline.onState(callback) }
  onFiles(callback: (files: DeviceFile[]) => void): Unsubscribe { return window.electronAPI.devicePipeline.onFiles(callback) }
}
