import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { JensenDevice } from '@hidock/jensen-protocol'
import { HostedRecorder, isTrustedServerFrame } from '../hosted-recorder'
let directory: string, device: any, recorder: HostedRecorder
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hidock-native-tests-'))
  device = { getRecordingFile: vi.fn(async () => ({ recording: null })), getActiveDownloadSettlement: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined), deleteFile: vi.fn(async () => ({ result: 'success' })), connect: vi.fn(async () => true), tryConnect: vi.fn(async () => false), downloadFile: vi.fn(async (_name, length, chunk, progress) => { const bytes = new Uint8Array(length).fill(7); chunk(bytes); progress(length); return true }) }
  recorder = new HostedRecorder(device as JensenDevice, directory, vi.fn())
})
afterEach(async () => { await recorder.close(); await rm(directory, { recursive: true, force: true }) })
describe('native USB for a hosted library', () => {
  it('opens native USB without starting local database or processing services', async () => { expect(await recorder.call('connect', [false])).toBe(true); expect(await recorder.call('connect', [true])).toBe(false); expect(device.connect).toHaveBeenCalledOnce(); expect(device.tryConnect).toHaveBeenCalledOnce() })
  it('stages a verified-length transfer and serves bounded chunks without exposing file paths', async () => {
    const stage = await recorder.call('download:begin', ['meeting.hda', 150000]) as { id: string; size: number }
    expect(Object.keys(stage).sort()).toEqual(['id', 'size']); expect(recorder.busy).toBe(true)
    let received = 0
    while (received < stage.size) { const bytes = await recorder.call('download:read', [stage.id, received]) as Uint8Array; expect(bytes.length).toBeLessThanOrEqual(65536); expect(bytes.every(value => value === 7)).toBe(true); received += bytes.length }
    expect(received).toBe(150000)
    await recorder.call('download:finish', [stage.id]); expect(recorder.busy).toBe(false); expect(await readdir(directory)).toEqual([])
    expect(device.deleteFile).not.toHaveBeenCalled()
  })
  it('rejects incomplete data and cleans temporary files while keeping the device original', async () => { device.downloadFile.mockImplementation(async (_name, _length, chunk) => { chunk(new Uint8Array(3)); return true }); await expect(recorder.call('download:begin', ['meeting.hda', 10])).rejects.toThrow('interrupted'); expect(await readdir(directory)).toEqual([]); expect(device.deleteFile).not.toHaveBeenCalled() })
  it('cancels and drains USB before disconnecting and releases its temporary file', async () => {
    device.downloadFile.mockImplementation(async (_name, _length, _chunk, _progress, signal) => { await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true })); return false })
    const download = recorder.call('download:begin', ['meeting.hda', 100]); const failed = expect(download).rejects.toThrow()
    await vi.waitFor(() => expect(device.downloadFile).toHaveBeenCalled())
    await recorder.close(); await failed; expect(device.getActiveDownloadSettlement).toHaveBeenCalled(); expect(device.disconnect).toHaveBeenCalled(); expect(await readdir(directory)).toEqual([])
  })
  it('cannot delete a currently recording file or accept paths and arbitrary native calls', async () => { device.getRecordingFile.mockResolvedValue({ recording: 'active.hda' }); await expect(recorder.call('deleteFile', ['active.hda', true])).rejects.toThrow('completed'); await expect(recorder.call('download:begin', ['../private.hda', 20])).rejects.toThrow('filename'); await expect(recorder.call('filesystem:read', ['/data/secrets/server.key'])).rejects.toThrow('Unsupported'); expect(device.deleteFile).not.toHaveBeenCalled() })
  it.each(['https://notes.example.com.evil.test/', 'https://other.test/', 'file:///tmp/index.html', 'data:text/html,HiDock', 'not-a-url'])('rejects a non-app frame origin: %s', value => { expect(isTrustedServerFrame(value, 'https://notes.example.com')).toBe(false) })
  it('accepts only the exact configured server origin', () => { expect(isTrustedServerFrame('https://notes.example.com/#/sync', 'https://notes.example.com')).toBe(true) })
})
