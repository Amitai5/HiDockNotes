import { BrowserCapture } from './browser-capture'
import { JensenDevice, USB_VENDOR_IDS, supportsRealtimeFirmware, type DeviceInfo } from '@hidock/jensen-protocol'
import type { AppClient, DeviceFile, DownloadState } from '../shared/contracts'
import type { PipelineState } from '../shared/device-pipeline'
import { clientEvents, invoke, request } from './http'
import { hashBlob } from './hash'
import { uploadAudio } from './upload'
import { desktopBridge, DesktopRecorder, type RecorderTransport } from './desktop-recorder'
import { browserStorageAvailability } from './browser-storage'

export function usbAvailability(): string | null { return !window.isSecureContext ? 'Device sync needs HTTPS. Open the secure server address.' : !desktopBridge() && !navigator.usb ? 'Use desktop Chrome or Edge for USB sync. You can upload audio in this browser.' : !navigator.locks ? 'Update your browser to use device sync.' : null }
export class BrowserDevice {
  private readonly native = desktopBridge()
  private readonly device: RecorderTransport = this.native ? new DesktopRecorder(this.native) : new JensenDevice(typeof navigator !== 'undefined' ? navigator.usb : undefined)
  private state: PipelineState = { phase: 'disconnected', device: null, error: null, scanProgress: null, downloadProgress: null }
  private files: DeviceFile[] = []
  private downloads: DownloadState = { queue: [], isPaused: false, isProcessing: false }
  private listeners = new EventTarget()
  private release: (() => void) | null = null
  private ownership: Promise<void> | null = null
  private controller: AbortController | null = null
  private task: Promise<void> | null = null
  private info: DeviceInfo | null = null
  private readonly stagedKeys = new Map<string, string>()
  private capture: BrowserCapture | null = null
  get isCapturing(): boolean { return this.capture?.active ?? false }
  get busy(): boolean { return !!this.task || this.isCapturing || !['idle','disconnected','error'].includes(this.state.phase) }
  private publish(patch: Partial<PipelineState>): void { this.state = { ...this.state, ...patch }; this.listeners.dispatchEvent(new CustomEvent('state', { detail: this.state })) }
  private emit(name: string, value: unknown): void { this.listeners.dispatchEvent(new CustomEvent(name, { detail: value })) }
  private on<T>(name: string, callback: (value: T) => void): () => void { const listener = (event: Event) => callback((event as CustomEvent<T>).detail); this.listeners.addEventListener(name, listener); return () => this.listeners.removeEventListener(name, listener) }
  private async claim(): Promise<void> { if (this.release) return; await new Promise<void>((resolve, reject) => { this.ownership = navigator.locks.request('hidock-usb-owner', { ifAvailable: true }, async lock => { if (!lock) { reject(new Error('Another HiDockNotes tab or installed window owns the recorder. Disconnect it there first.')); return }; await new Promise<void>(done => { this.release = done; resolve() }) }).catch(error => { reject(error) }) }) }
  async connect(automatic = false): Promise<boolean> {
    const reason = usbAvailability(); if (reason) throw new Error(reason)
    if (this.busy || this.release) return this.device.isConnected()
    // The permission picker starts synchronously in the click handler.
    const selection = this.native ? Promise.resolve(null) : automatic ? navigator.usb.getDevices().then(devices => devices.find(device => USB_VENDOR_IDS.includes(device.vendorId))) : navigator.usb.requestDevice({ filters: USB_VENDOR_IDS.map(vendorId => ({ vendorId })) })
    this.publish({ phase: 'connecting', error: null })
    try { const selected = await selection; if (!selected && !this.native) { this.publish({ phase: 'disconnected' }); return false }; await this.claim(); if (!(this.device instanceof DesktopRecorder ? await (automatic ? this.device.autoConnect() : this.device.tryConnect()) : await this.device.tryConnect(selected!))) throw new Error('The recorder could not be opened. Close other recorder apps and reconnect the USB cable.'); this.info = await this.device.getDeviceInfo(); if (!this.info?.serialNumber) throw new Error('The recorder did not provide a stable identity. Reconnect it before syncing.'); const card = await this.device.getCardInfo(), settings = await this.device.getSettings(), battery = await this.device.getBatteryStatus(); this.publish({ phase: 'idle', device: { model: this.info.model, serialNumber: this.info.serialNumber, firmwareVersion: this.info.versionCode, storage: card ? { used: card.used, capacity: card.capacity, freePercent: card.capacity ? Math.round(card.free / card.capacity * 100) : 0 } : null, settings, battery, recordingCount: 0 } }); await this.sync(); return true } catch (error) { await this.device.disconnect(); await this.freeLock(); this.publish({ phase: 'error', device: null, error: error instanceof Error ? error.message : 'Connection failed.' }); if (automatic) return false; throw error }
  }
  private async freeLock(): Promise<void> { this.release?.(); this.release = null; const ownership = this.ownership; this.ownership = null; await ownership }
  async disconnect(): Promise<void> { try { await this.cancel(); if (this.capture) await this.stopCapture() } finally { await this.device.disconnect(); await this.freeLock(); this.files = []; this.emit('files', this.files); this.publish({ phase: 'disconnected', device: null, error: null }) } }
  async sync(): Promise<void> {
    if (this.busy || !this.info || !this.device.isConnected()) return
    this.publish({ phase: 'scanning' })
    try { const recording = await this.device.getRecordingFile(); const files = await this.device.listFiles((current, total) => this.publish({ scanProgress: { current, total } })); if (!files) throw new Error('The recorder file list could not be read.'); const manifest = await this.manifest(); this.files = files.map(file => ({ ...file, active: file.name === recording?.recording, localVerified: manifest.recordings.some(saved => saved.filename === file.name && saved.size === file.length) })); this.emit('files', this.files); this.publish({ device: this.state.device ? { ...this.state.device, recordingCount: files.length } : null }); await this.cleanup(manifest.commands); this.publish({ phase: 'idle', scanProgress: null }); const settings = await invoke<{ autoDownload: boolean }>('settings:get'); if (settings.autoDownload) await this.download(this.files.filter(file => !file.active && !file.localVerified).map(file => file.name)) } catch (error) { this.publish({ phase: 'error', error: error instanceof Error ? error.message : 'Sync failed.', scanProgress: null }); throw error }
  }
  private manifest(): Promise<{ recordings: { filename: string; size: number; checksum: string }[]; commands: { id: string; filename: string; size: number; checksum: string }[] }> { return request('/api/v1/device/manifest?serial=' + encodeURIComponent(this.info!.serialNumber)) }
  private async cleanup(commands: Awaited<ReturnType<BrowserDevice['manifest']>>['commands']): Promise<void> {
    for (const command of commands) { const file = this.files.find(file => file.name === command.filename); if (file?.active) continue; if (file) { if (file.length !== command.size) continue; const blob = await this.stage(file); if (await hashBlob(blob) !== command.checksum) continue; if ((await this.device.deleteFile(file.name))?.result !== 'success') throw new Error('Recorder cleanup was not acknowledged. It will be retried on reconnect.') }; await request('/api/v1/device/commands/' + command.id + '/ack', { serial: this.info!.serialNumber, checksum: command.checksum }); if (file) await this.discardStage(file.name); this.files = this.files.filter(file => file.name !== command.filename); this.emit('files', this.files) }
  }
  private async stage(file: DeviceFile): Promise<File> {
    const reason = browserStorageAvailability(); if (reason) throw new Error(reason)
    const root = await navigator.storage.getDirectory(), key = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.info!.serialNumber + ':' + file.name + ':' + file.length + ':' + file.signature)).then(value => [...new Uint8Array(value)].map(n => n.toString(16).padStart(2,'0')).join(''))
    const directory = await root.getDirectoryHandle('hidock-staging', { create: true }), handle = await directory.getFileHandle(key, { create: true }), marker = key + '.complete'
    this.stagedKeys.set(file.name, key)
    if ((await handle.getFile()).size === file.length && await directory.getFileHandle(marker).then(() => true).catch(() => false)) return handle.getFile()
    const estimate = await navigator.storage.estimate(); if (estimate.quota && estimate.quota - (estimate.usage ?? 0) < file.length + 8 * 1024 ** 2) throw new Error('This browser needs more temporary storage to sync the recording.')
    const writable = await handle.createWritable(), signal = this.controller?.signal; let buffered = 0, received = 0, failure: unknown; let writes = Promise.resolve()
    try { const complete = await this.device.downloadFile(file.name, file.length, chunk => { const copy = chunk.slice(); buffered += copy.byteLength; if (buffered > 8 * 1024 ** 2) { failure = new Error('Browser storage could not keep up. Retry this recording.'); this.controller?.abort(); return }; writes = writes.then(async () => { if (failure) return; await writable.write(copy); buffered -= copy.length }).catch(error => { failure = error; this.controller?.abort() }) }, bytes => { received = bytes; this.publish({ downloadProgress: { filename: file.name, current: 1, total: 1, bytesDownloaded: bytes, totalBytes: file.length, eta: null } }) }, signal); await this.device.getActiveDownloadSettlement(); await writes; if (failure) throw failure; if (!complete || received !== file.length) throw new Error('The transfer was interrupted. The original stays on the recorder.'); await writable.close(); const completion = await (await directory.getFileHandle(marker, { create: true })).createWritable(); await completion.close(); return handle.getFile() } catch (error) { await writable.abort().catch(() => undefined); throw error }
  }
  private async discardStage(name: string): Promise<void> { const key = this.stagedKeys.get(name); if (!key) return; const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('hidock-staging'); await directory.removeEntry(key); await directory.removeEntry(key + '.complete').catch(() => undefined); this.stagedKeys.delete(name) }
  async download(names: string[]): Promise<void> {
    if (this.busy || !this.info) throw new Error('Wait for the recorder to finish its current operation.')
    this.controller = new AbortController(); this.publish({ phase: 'downloading', error: null }); this.downloads = { isPaused: false, isProcessing: true, queue: names.map(filename => ({ filename, fileSize: this.files.find(f => f.name === filename)?.length ?? 0, progress: 0, status: 'pending' })) }; this.emit('downloads', this.downloads)
    const task = (async () => { for (const name of names) { this.controller!.signal.throwIfAborted(); const file = this.files.find(f => f.name === name); if (!file || file.active) throw new Error('The recording is still being saved on the recorder.'); const item = this.downloads.queue.find(row => row.filename === name)!; item.status = 'downloading'; this.emit('downloads', this.downloads); const blob = await this.stage(file); await uploadAudio(blob, { filename: file.name, deviceFilename: file.name, serial: this.info!.serialNumber, recordedAt: file.time?.toISOString() }, bytes => { item.progress = bytes / file.length * 100; this.emit('downloads', this.downloads) }, this.controller!.signal); await this.discardStage(file.name); item.status = 'completed'; item.progress = 100; file.localVerified = true; this.emit('files', this.files); this.emit('downloads', this.downloads); clientEvents.dispatchEvent(new CustomEvent('library:changed')) } })(); this.task = task
    try { await task; this.publish({ phase: 'idle' }) } catch (error) { for (const item of this.downloads.queue) if (item.status !== 'completed') { item.status = this.controller.signal.aborted ? 'cancelled' : 'failed'; item.error = error instanceof Error ? error.message : 'Download failed.' }; this.publish({ phase: this.device.isConnected() ? 'idle' : 'error', error: error instanceof Error ? error.message : 'Download failed.' }); throw error } finally { this.task = null; this.controller = null; this.downloads.isProcessing = false; this.emit('downloads', this.downloads); this.publish({ downloadProgress: null }) }
  }
  async cancel(): Promise<void> { this.controller?.abort(); await this.task?.catch(() => undefined); await this.device.getActiveDownloadSettlement() }
  async deleteFile(name: string, confirmed: boolean): Promise<{ result: string } | null> { if (!confirmed || this.busy || !this.info) throw new Error('Confirm deletion while the recorder is idle.'); const file = this.files.find(file => file.name === name); const verified = (await this.manifest()).recordings.find(row => row.filename === name && row.size === file?.length); if (!file || file.active || !verified || await hashBlob(await this.stage(file)) !== verified.checksum) throw new Error('A matching verified server copy is required.'); const result = await this.device.deleteFile(name); if (result?.result === 'success') { this.files = this.files.filter(file => file.name !== name); this.emit('files', this.files) }; return result }
  async startCapture(): Promise<void> {
    const reason = usbAvailability() ?? browserStorageAvailability(); if (reason) throw new Error(reason)
    if (this.busy || !this.info || !supportsRealtimeFirmware(this.info.model, this.info.versionNumber)) throw new Error('Live capture requires a connected recorder with supported firmware.')
    const capture = new BrowserCapture(this.device, error => this.publish({ error: error ?? null }))
    this.capture = capture
    this.publish({ phase: 'initializing' })
    try { await capture.start(this.info.serialNumber) } finally { this.publish({ phase: this.device.isConnected() ? 'idle' : 'disconnected' }) }
  }
  async stopCapture(): Promise<void> { const capture = this.capture; if (!capture) return; try { await capture.stop() } finally { this.capture = null; this.publish({}) } }
  readonly api: AppClient['devicePipeline'] = { getState: async () => this.state, getFiles: async () => this.files, getDownloads: async () => this.downloads, connect: () => this.connect(), disconnect: () => this.disconnect(), sync: () => this.sync(), cancel: () => this.cancel(), download: names => this.download(names), deleteFile: (name, confirmed) => this.deleteFile(name, confirmed), syncTime: async () => { if (this.busy) throw new Error('Recorder is busy.'); if ((await this.device.setTime(new Date()))?.result !== 'success') throw new Error('Time sync was not confirmed.'); const time = await this.device.getTime(); this.publish({ device: this.state.device ? { ...this.state.device, time: time?.time } : null }) }, setAutoRecord: async enabled => { if (this.busy) throw new Error('Recorder is busy.'); if ((await this.device.setAutoRecord(enabled))?.result !== 'success') throw new Error('Setting was not confirmed.'); this.publish({ device: this.state.device ? { ...this.state.device, settings: { autoRecord: enabled } } : null }) }, onState: callback => this.on('state', callback), onFiles: callback => this.on('files', callback), onDownloads: callback => this.on('downloads', callback) }
}
export const browserDevice = new BrowserDevice()
