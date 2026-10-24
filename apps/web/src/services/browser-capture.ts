import type { RealtimeData } from '@hidock/jensen-protocol'
import { request, response, clientEvents } from './http'
import { browserStorageAvailability } from './browser-storage'

interface CaptureSource { startRealtime(mode: number): Promise<{ result: string } | null>; stopRealtime(): Promise<{ result: string } | null>; getRealtimeData(): Promise<RealtimeData | null> }
interface CaptureRecord { id: string; serial: string }
interface ServerCapture { id: string; state: string; frames: number; bytes: number }
const BLOCK = 64 * 1024
const LIMIT = 8 * 1024 * 1024
async function root(): Promise<FileSystemDirectoryHandle> { const reason = browserStorageAvailability(); if (reason) throw new Error(reason); return (await navigator.storage.getDirectory()).getDirectoryHandle('hidock-captures', { create: true }) }
async function save(directory: FileSystemDirectoryHandle, name: string, data: Uint8Array | string): Promise<void> { const writable = await (await directory.getFileHandle(name, { create: true })).createWritable(); try { await writable.write(data); await writable.close() } catch (error) { await writable.abort().catch(() => undefined); throw error } }

/** Durable PCM chunks decouple USB reads from server latency. Only acknowledged chunks are discarded. */
export class BrowserCapture {
  active = false
  private stopping = false
  private drained = false
  private normalStop = false
  private readTask: Promise<void> | null = null
  private uploadTask: Promise<void> | null = null
  private writes = Promise.resolve()
  private failure: unknown
  private count = 0
  private committed = 0
  private pending = 0
  private directory: FileSystemDirectoryHandle | null = null
  private record: CaptureRecord | null = null
  constructor(private readonly source: CaptureSource, private readonly changed: (error?: string) => void) {}
  async start(serial: string): Promise<void> {
    const reason = browserStorageAvailability(); if (reason) throw new Error(reason)
    const capture = await request<{ id: string }>('/api/v1/captures', { serial })
    this.record = { id: capture.id, serial }; this.directory = await (await root()).getDirectoryHandle(capture.id, { create: true })
    await save(this.directory, 'capture.json', JSON.stringify(this.record))
    if ((await this.source.startRealtime(2))?.result !== 'success') throw new Error('The recorder could not start streaming.')
    this.active = true; this.changed()
    this.readTask = this.read()
    this.uploadTask = this.upload()
    void this.uploadTask.catch(error => { this.failure = error; this.stopping = true })
    void this.readTask.finally(async () => { await this.uploadTask?.catch(() => undefined); this.active = false; this.changed(this.failure instanceof Error ? this.failure.message : undefined); if (!this.normalStop || this.failure) await request('/api/v1/captures/' + this.record!.id + '/interrupt', {}).catch(() => undefined) }).catch(() => undefined)
  }
  private enqueue(data: Uint8Array): void {
    if (!this.directory) throw new Error('Capture storage is unavailable.')
    const sequence = this.count++; this.pending += data.length
    if (this.pending > LIMIT) throw new Error('Browser storage could not keep up. The captured prefix can be recovered in Sync.')
    this.writes = this.writes.then(async () => { await save(this.directory!, String(sequence).padStart(8, '0') + '.pcm', data); this.pending -= data.length; this.committed++ }).catch(error => { this.failure = error; this.stopping = true })
  }
  private async read(): Promise<void> {
    let buffer = new Uint8Array(BLOCK), used = 0
    try {
      while (!this.stopping) {
        const packet = await this.source.getRealtimeData()
        if (!packet) throw new Error('The recorder stream stopped. Recover its captured prefix in Sync.')
        const pcm = packet.data.subarray(8)
        if (pcm.length % 4) throw new Error('The recorder returned an unsupported audio format. Its saved prefix is available in Sync.')
        let offset = 0
        while (offset < pcm.length) { const take = Math.min(BLOCK - used, pcm.length - offset); buffer.set(pcm.subarray(offset, offset + take), used); offset += take; used += take; if (used === BLOCK) { this.enqueue(buffer); buffer = new Uint8Array(BLOCK); used = 0 } }
      }
    } catch (error) { this.failure = error }
    finally { this.stopping = true; if (used) { try { this.enqueue(buffer.slice(0, used)) } catch (error) { this.failure ??= error } }; await this.writes; await this.source.stopRealtime().catch(() => undefined); this.drained = true }
  }
  private async upload(): Promise<void> {
    let sequence = 0
    while (!this.drained || sequence < this.committed || this.pending > 0) {
      if (sequence >= this.committed) { if (this.failure) break; await new Promise(resolve => setTimeout(resolve, 40)); continue }
      const file = await (await this.directory!.getFileHandle(String(sequence).padStart(8, '0') + '.pcm')).getFile()
      const result = await response('/api/v1/captures/' + this.record!.id + '?sequence=' + sequence, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
      const ack = await result.json(); if (ack.frames !== sequence + 1) throw new Error('The server capture acknowledgement was out of order. Recover the saved prefix in Sync.')
      sequence++
    }
  }
  async stop(): Promise<void> {
    this.normalStop = true; this.stopping = true; await this.readTask; await this.uploadTask
    if (this.failure) throw this.failure
    await request('/api/v1/captures/' + this.record!.id + '/finish', {})
    await (await root()).removeEntry(this.record!.id, { recursive: true }); this.active = false; this.changed(); clientEvents.dispatchEvent(new CustomEvent('library:changed'))
  }
}

/** Replays durable browser chunks against the server's authoritative acknowledgement after a tab or network interruption. */
export async function recoverBrowserCaptures(): Promise<number> {
  if (!navigator.locks) return recover()
  return navigator.locks.request('hidock-usb-owner', { ifAvailable: true }, async lock => { if (!lock) throw new Error('Disconnect the recorder before recovering browser capture audio.'); return recover() })
}
async function recover(): Promise<number> {
  const directory = await root(), handles: FileSystemDirectoryHandle[] = []
  for await (const entry of (directory as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) if (entry.kind === 'directory' && /^[a-f0-9-]{36}$/.test(entry.name)) handles.push(await directory.getDirectoryHandle(entry.name))
  let restored = 0
  for (const handle of handles) {
    const record = JSON.parse(await (await (await handle.getFileHandle('capture.json')).getFile()).text()) as CaptureRecord
    if (!/^[a-f0-9-]{36}$/.test(record.id) || !/^[\w-]{1,100}$/.test(record.serial)) throw new Error('Invalid browser capture recovery metadata.')
    let state = await request<ServerCapture>('/api/v1/captures/' + record.id + '/resume', {})
    if (state.state === 'completed') {
      let bytes = 0
      for await (const entry of (handle as FileSystemDirectoryHandle & { values(): AsyncIterableIterator<FileSystemHandle> }).values()) if (entry.kind === 'file' && /^\d{8}\.pcm$/.test(entry.name)) bytes += (await (await handle.getFileHandle(entry.name)).getFile()).size
      if (bytes <= state.bytes) { await directory.removeEntry(handle.name, { recursive: true }); continue }
      // A finalized server prefix must not cause the browser's additional audio to be discarded.
      const recovered = await request<{ id: string }>('/api/v1/captures', { serial: record.serial }); record.id = recovered.id
      await save(handle, 'capture.json', JSON.stringify(record)); state = { id: record.id, state: 'recording', frames: 0, bytes: 0 }
    }
    let sequence = 0, bytes = 0
    for (;;) {
      const file = await handle.getFileHandle(String(sequence).padStart(8, '0') + '.pcm').then(item => item.getFile()).catch(() => null)
      if (!file) break
      if (sequence < state.frames) bytes += file.size
      else {
        if (sequence === state.frames && bytes !== state.bytes) throw new Error('The server prefix differs from this browser capture. Preserve both copies and retry recovery.')
        await response('/api/v1/captures/' + record.id + '?sequence=' + sequence, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file })
      }
      sequence++
    }
    if (!sequence) continue
    if (sequence < state.frames) throw new Error('The browser no longer has every captured chunk. Save the server prefix instead.')
    await request('/api/v1/captures/' + record.id + '/finish', {}); await directory.removeEntry(handle.name, { recursive: true }); restored++
  }
  clientEvents.dispatchEvent(new CustomEvent('library:changed')); return restored
}
