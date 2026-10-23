import { appClient } from './app-client'
// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/** Jensen IPC client: a projection and scoped actions, with no renderer USB or filesystem. */
import type { PipelineState } from '../shared/device-pipeline'
import type { DeviceFile, Unsubscribe } from '../shared/contracts'

export class JensenIpcClient {
  getState(): Promise<PipelineState> { return appClient.devicePipeline.getState() }
  listFiles(): Promise<DeviceFile[]> { return appClient.devicePipeline.getFiles() }
  connect(): Promise<boolean> { return appClient.devicePipeline.connect() }
  disconnect(): Promise<void> { return appClient.devicePipeline.disconnect() }
  downloadFiles(filenames: string[]): Promise<void> { return appClient.devicePipeline.download(filenames) }
  cancelDownloads(): Promise<void> { return appClient.devicePipeline.cancel() }
  onState(callback: (state: PipelineState) => void): Unsubscribe { return appClient.devicePipeline.onState(callback) }
  onFiles(callback: (files: DeviceFile[]) => void): Unsubscribe { return appClient.devicePipeline.onFiles(callback) }
}
