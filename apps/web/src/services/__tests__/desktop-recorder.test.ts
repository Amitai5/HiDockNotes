import { expect, it, vi } from 'vitest'
import { DesktopRecorder, type DesktopBridge } from '../desktop-recorder'
it('feeds bounded native USB chunks through the existing upload staging callback', async () => {
  const bytes = new Uint8Array(150000).fill(9), chunks: Uint8Array[] = [], progress = vi.fn(), unsubscribe = vi.fn()
  const bridge: DesktopBridge = { version: 1, onDetached: () => () => undefined, onProgress: () => unsubscribe, call: vi.fn(async (operation, args) => {
    if (operation === 'connect') return true
    if (operation === 'download:begin') return { id: 'transfer', size: bytes.length }
    if (operation === 'download:read') return bytes.slice(Number(args[1]), Number(args[1]) + 65536)
    return null
  }) }
  const device = new DesktopRecorder(bridge)
  expect(await device.tryConnect()).toBe(true)
  expect(await device.downloadFile('meeting.hda', bytes.length, chunk => { chunks.push(chunk) }, progress)).toBe(true)
  expect(chunks.map(chunk => chunk.length)).toEqual([65536, 65536, 18928]); expect(chunks.every(chunk => chunk.every(value => value === 9))).toBe(true)
  expect(bridge.call).toHaveBeenCalledWith('download:finish', ['transfer']); expect(unsubscribe).toHaveBeenCalledOnce(); expect(progress).toHaveBeenLastCalledWith(bytes.length)
})
it('rejects a truncated native stage and releases it without treating it as a successful download', async () => {
  const call = vi.fn(async (operation: string) => operation === 'download:begin' ? { id: 'transfer', size: 100 } : operation === 'download:read' ? new Uint8Array() : null)
  const device = new DesktopRecorder({ version: 1, call, onDetached: () => () => undefined, onProgress: () => () => undefined })
  await expect(device.downloadFile('meeting.hda', 100, vi.fn())).rejects.toThrow('incomplete')
  expect(call).toHaveBeenCalledWith('download:finish', ['transfer'])
})

it('waits for browser storage before reading the next native chunk', async () => {
  let release!: () => void, started!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve }), writing = new Promise<void>(resolve => { started = resolve })
  const call = vi.fn(async (operation: string) => operation === 'download:begin' ? { id: 'transfer', size: 131072 } : operation === 'download:read' ? new Uint8Array(65536) : null)
  const device = new DesktopRecorder({ version: 1, call, onDetached: () => () => undefined, onProgress: () => () => undefined })
  const sink = vi.fn(async () => { started(); await blocked })
  const task = device.downloadFile('meeting.hda', 131072, sink)
  await writing
  expect(call.mock.calls.filter(([operation]) => operation === 'download:read')).toHaveLength(1)
  expect(call).not.toHaveBeenCalledWith('download:finish', ['transfer'])
  release(); expect(await task).toBe(true); expect(sink).toHaveBeenCalledTimes(2)
})

it('stops after a failed storage write and releases the native stage', async () => {
  const call = vi.fn(async (operation: string) => operation === 'download:begin' ? { id: 'transfer', size: 131072 } : operation === 'download:read' ? new Uint8Array(65536) : null)
  const device = new DesktopRecorder({ version: 1, call, onDetached: () => () => undefined, onProgress: () => () => undefined })
  await expect(device.downloadFile('meeting.hda', 131072, async () => { throw Error('Storage is full') })).rejects.toThrow('Storage is full')
  expect(call.mock.calls.filter(([operation]) => operation === 'download:read')).toHaveLength(1)
  expect(call).toHaveBeenCalledWith('download:finish', ['transfer'])
})

it('cancels during a storage write without reading another native chunk', async () => {
  const controller = new AbortController()
  let release!: () => void, started!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve }), writing = new Promise<void>(resolve => { started = resolve })
  const call = vi.fn(async (operation: string) => operation === 'download:begin' ? { id: 'transfer', size: 131072 } : operation === 'download:read' ? new Uint8Array(65536) : null)
  const device = new DesktopRecorder({ version: 1, call, onDetached: () => () => undefined, onProgress: () => () => undefined })
  const task = device.downloadFile('meeting.hda', 131072, async () => { started(); await blocked }, undefined, controller.signal), failed = expect(task).rejects.toThrow()
  await writing; controller.abort()
  expect(call).toHaveBeenCalledWith('cancel', [])
  release(); await failed
  expect(call.mock.calls.filter(([operation]) => operation === 'download:read')).toHaveLength(1)
  expect(call).toHaveBeenCalledWith('download:finish', ['transfer'])
})
