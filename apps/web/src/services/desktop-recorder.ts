import type { JensenDevice } from '@hidock/jensen-protocol'
export type RecorderTransport = Pick<JensenDevice, 'isConnected' | 'tryConnect' | 'disconnect' | 'getDeviceInfo' | 'getCardInfo' | 'getSettings' | 'getBatteryStatus' | 'getRecordingFile' | 'getTime' | 'listFiles' | 'downloadFile' | 'getActiveDownloadSettlement' | 'deleteFile' | 'setTime' | 'setAutoRecord' | 'startRealtime' | 'stopRealtime' | 'getRealtimeData'>
export interface DesktopBridge { version: 1; call(operation: string, args: unknown[]): Promise<any>; onProgress(callback: (bytes: number) => void): () => void; onDetached(callback: () => void): () => void }
declare global { interface Window { hidockDesktop?: DesktopBridge } }
export function desktopBridge(): DesktopBridge | undefined { return typeof window !== 'undefined' && window.hidockDesktop?.version === 1 ? window.hidockDesktop : undefined }

/** Native USB feeds the existing browser staging/checksum/upload pipeline. Server auth stays in browser cookies. */
export class DesktopRecorder implements RecorderTransport {
  private connected = false
  private transfer: Promise<boolean> | null = null
  constructor(private readonly bridge: DesktopBridge) {}
  isConnected = () => this.connected
  async tryConnect(): Promise<boolean> { this.connected = await this.bridge.call('connect', [false]); return this.connected }
  async autoConnect(): Promise<boolean> { this.connected = await this.bridge.call('connect', [true]); return this.connected }
  async disconnect(): Promise<void> { await this.bridge.call('disconnect', []); this.connected = false }
  getDeviceInfo: RecorderTransport['getDeviceInfo'] = () => this.bridge.call('getDeviceInfo', [])
  getCardInfo: RecorderTransport['getCardInfo'] = () => this.bridge.call('getCardInfo', [])
  getSettings: RecorderTransport['getSettings'] = () => this.bridge.call('getSettings', [])
  getBatteryStatus: RecorderTransport['getBatteryStatus'] = () => this.bridge.call('getBatteryStatus', [])
  getRecordingFile: RecorderTransport['getRecordingFile'] = () => this.bridge.call('getRecordingFile', [])
  getTime: RecorderTransport['getTime'] = () => this.bridge.call('getTime', [])
  listFiles: RecorderTransport['listFiles'] = () => this.bridge.call('listFiles', [])
  deleteFile: RecorderTransport['deleteFile'] = name => this.bridge.call('deleteFile', [name, true])
  setTime: RecorderTransport['setTime'] = date => this.bridge.call('setTime', [date.toISOString()])
  setAutoRecord: RecorderTransport['setAutoRecord'] = enabled => this.bridge.call('setAutoRecord', [enabled])
  startRealtime: RecorderTransport['startRealtime'] = mode => this.bridge.call('startRealtime', [mode])
  stopRealtime: RecorderTransport['stopRealtime'] = () => this.bridge.call('stopRealtime', [])
  getRealtimeData: RecorderTransport['getRealtimeData'] = () => this.bridge.call('getRealtimeData', [])
  async getActiveDownloadSettlement(): Promise<void> { await this.transfer?.catch(() => undefined) }
  downloadFile: RecorderTransport['downloadFile'] = (name, length, chunk, progress, signal) => {
    const abort = () => { void this.bridge.call('cancel', []).catch(() => undefined) }
    const unsubscribe = this.bridge.onProgress(bytes => progress?.(bytes))
    const task = (async () => {
      signal?.throwIfAborted(); signal?.addEventListener('abort', abort, { once: true })
      const stage = await this.bridge.call('download:begin', [name, length]) as { id: string; size: number }
      try {
        if (stage.size !== length) throw new Error('The native transfer size does not match the recorder.')
        let offset = 0
        while (offset < length) {
          signal?.throwIfAborted()
          const bytes = new Uint8Array(await this.bridge.call('download:read', [stage.id, offset]))
          if (!bytes.length || bytes.length > 65536 || offset + bytes.length > length) throw new Error('The native recorder returned an incomplete transfer.')
          chunk(bytes); offset += bytes.length
        }
        signal?.throwIfAborted(); progress?.(length); return true
      } finally { await this.bridge.call('download:finish', [stage.id]).catch(() => undefined) }
    })().finally(() => { signal?.removeEventListener('abort', abort); unsubscribe(); if (this.transfer === task) this.transfer = null })
    this.transfer = task
    return task
  }
}
