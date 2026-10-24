import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { JensenDevice } from '@hidock/jensen-protocol'

type Recorder = Pick<JensenDevice, 'connect' | 'tryConnect' | 'disconnect' | 'getDeviceInfo' | 'getCardInfo' | 'getSettings' | 'getBatteryStatus' | 'getRecordingFile' | 'getTime' | 'listFiles' | 'downloadFile' | 'getActiveDownloadSettlement' | 'deleteFile' | 'setTime' | 'setAutoRecord' | 'startRealtime' | 'stopRealtime' | 'getRealtimeData'>
interface Stage { id: string; folder: string; file: FileHandle; size: number }
const filename = (value: unknown): string => { if (typeof value !== 'string' || !/^[\w .()-]{1,200}\.(?:hda|wav|mp3)$/i.test(value)) throw new Error('Invalid recorder filename.'); return value }
const size = (value: unknown, max: number): number => { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > max) throw new Error('Invalid recorder transfer size.'); return Number(value) }

/** Native USB only. This service has no account tokens, server client, database or AI workers. */
export class HostedRecorder {
  private controller: AbortController | null = null
  private transfer: Promise<unknown> | null = null
  private stage: Stage | null = null
  private streaming = false
  constructor(private readonly device: Recorder, private readonly temporaryPath: string, private readonly progress: (bytes: number) => void) {}
  get busy(): boolean { return !!this.controller || this.streaming }
  async call(operation: string, args: unknown[]): Promise<unknown> {
    if (!Array.isArray(args) || args.length > 3) throw new Error('Invalid native recorder request.')
    if (this.busy && !['download:read', 'download:finish', 'cancel', 'disconnect', 'getRealtimeData', 'stopRealtime'].includes(operation)) throw new Error('Finish the current recorder operation first.')
    switch (operation) {
      case 'connect': return args[0] === true ? this.device.tryConnect() : this.device.connect()
      case 'disconnect': await this.close(); return null
      case 'getDeviceInfo': return this.device.getDeviceInfo()
      case 'getCardInfo': return this.device.getCardInfo()
      case 'getSettings': return this.device.getSettings()
      case 'getBatteryStatus': return this.device.getBatteryStatus()
      case 'getRecordingFile': return this.device.getRecordingFile()
      case 'getTime': return this.device.getTime()
      case 'listFiles': return this.device.listFiles()
      case 'setTime': { const date = new Date(String(args[0])); if (!Number.isFinite(date.getTime())) throw new Error('Invalid recorder time.'); return this.device.setTime(date) }
      case 'setAutoRecord': if (typeof args[0] !== 'boolean') throw new Error('Invalid auto-record setting.'); return this.device.setAutoRecord(args[0])
      case 'deleteFile': { const name = filename(args[0]); if (args[1] !== true || (await this.device.getRecordingFile())?.recording === name) throw new Error('Confirm deletion of a completed recording.'); return this.device.deleteFile(name) }
      case 'download:begin': return this.download(filename(args[0]), size(args[1], 2 * 1024 ** 3))
      case 'download:read': {
        const stage = this.stage
        if (!stage || args[0] !== stage.id || this.transfer) throw new Error('The native transfer is not ready.')
        const offset = size(args[1], stage.size), buffer = Buffer.alloc(Math.min(64 * 1024, stage.size - offset))
        const result = await stage.file.read(buffer, 0, buffer.length, offset)
        return new Uint8Array(buffer.subarray(0, result.bytesRead))
      }
      case 'download:finish': if (!this.stage || args[0] !== this.stage.id) throw new Error('Unknown native transfer.'); await this.clearStage(); this.controller = null; return null
      case 'cancel': await this.cancel(); return null
      case 'startRealtime': if (args[0] !== 2) throw new Error('Unsupported live capture mode.'); { const result = await this.device.startRealtime(2); this.streaming = result?.result === 'success'; return result }
      case 'stopRealtime': try { return await this.device.stopRealtime() } finally { this.streaming = false }
      case 'getRealtimeData': if (!this.streaming) return null; return this.device.getRealtimeData()
      default: throw new Error('Unsupported native recorder operation.')
    }
  }
  private async download(name: string, length: number): Promise<{ id: string; size: number }> {
    if (this.controller) throw new Error('A transfer is already running.')
    const active = await this.device.getRecordingFile()
    if (active?.recording === name) throw new Error('The recorder is still saving this recording.')
    this.controller = new AbortController()
    const signal = this.controller.signal
    const task = (async () => {
      const folder = await mkdtemp(join(this.temporaryPath, 'hidock-server-'))
      try {
        const file = await open(join(folder, 'recording.part'), 'wx+', 0o600)
        this.stage = { id: randomUUID(), folder, file, size: length }
        let received = 0, pending = 0, failure: unknown, writes = Promise.resolve()
        const complete = await this.device.downloadFile(name, length, chunk => {
          const bytes = Buffer.from(chunk); pending += bytes.length; received += bytes.length
          if (pending > 8 * 1024 ** 2 || received > length) { failure = new Error('Native recording staging could not keep up. The original remains on the recorder.'); this.controller?.abort(); return }
          writes = writes.then(async () => {
            if (failure) return
            let offset = 0
            while (offset < bytes.length) { const result = await file.write(bytes, offset, bytes.length - offset); if (!result.bytesWritten) throw new Error('Could not stage recorder audio.'); offset += result.bytesWritten }
            pending -= bytes.length
          }).catch(error => { failure = error; this.controller?.abort() })
        }, bytes => this.progress(bytes), signal).catch(error => { failure = error; return false })
        await this.device.getActiveDownloadSettlement(); await writes
        if (failure) throw failure
        signal.throwIfAborted()
        if (!complete || received !== length) throw new Error('Native transfer was interrupted. The original remains on the recorder.')
        return { id: this.stage.id, size: length }
      } catch (error) { await this.clearStage(); await rm(folder, { recursive: true, force: true }); throw error }
    })()
    this.transfer = task
    try { return await task } catch (error) { this.controller = null; throw error } finally { if (this.transfer === task) this.transfer = null }
  }
  private async clearStage(): Promise<void> { const stage = this.stage; this.stage = null; if (stage) { await stage.file.close(); await rm(stage.folder, { recursive: true, force: true }) } }
  async cancel(): Promise<void> { this.controller?.abort(); await this.transfer?.catch(() => undefined); await this.device.getActiveDownloadSettlement(); await this.clearStage(); this.controller = null }
  async close(): Promise<void> { await this.cancel(); try { if (this.streaming) await this.device.stopRealtime() } finally { this.streaming = false; await this.device.disconnect() } }
}

export function isTrustedServerFrame(frameUrl: string, origin: string): boolean {
  try { return new URL(frameUrl).origin === origin } catch { return false }
}
