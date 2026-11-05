// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { CMD, JensenDevice } from '../src/index.js'

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
function packet(body: number[]): USBInTransferResult {
  const bytes = new Uint8Array(12 + body.length), view = new DataView(bytes.buffer)
  view.setUint16(0, 0x1234); view.setUint16(2, CMD.TRANSFER_FILE); view.setUint32(4, 1); view.setUint32(8, body.length); bytes.set(body, 12)
  return { status: 'ok', data: view }
}
function transfer() {
  vi.useFakeTimers()
  const reads: Array<(value: USBInTransferResult) => void> = []
  const transferIn = vi.fn(() => new Promise<USBInTransferResult>(resolve => reads.push(resolve))), transferOut = vi.fn(async () => ({ bytesWritten: 0 }))
  const device = new JensenDevice({ getDevices: async () => [], requestDevice: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as USB)
  ;(device as unknown as { device: USBDevice }).device = { opened: true, transferIn, transferOut } as unknown as USBDevice
  return { device, reads, transferIn, transferOut }
}

it('bounds WebUSB read-ahead and pauses the stall timer while a slow sink persists audio', async () => {
  const { device, reads, transferIn } = transfer()
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const sink = vi.fn().mockImplementationOnce(() => blocked).mockResolvedValue(undefined)
  let finished = false
  const task = device.downloadFile('meeting.hda', 8, sink).then(result => { finished = true; return result })
  await vi.advanceTimersByTimeAsync(1)
  reads.shift()!(packet([1, 2, 3, 4])); await vi.advanceTimersByTimeAsync(1000)
  expect(sink).toHaveBeenCalledOnce()
  reads.shift()!(packet([5, 6, 7, 8])); await vi.advanceTimersByTimeAsync(130_000)
  expect(transferIn).toHaveBeenCalledTimes(2)
  expect(sink).toHaveBeenCalledOnce(); expect(finished).toBe(false); expect(device.isPoisoned()).toBe(false)
  release(); await vi.advanceTimersByTimeAsync(1000)
  expect(await task).toBe(true)
  expect(sink.mock.calls.map(([bytes]) => [...bytes])).toEqual([[1, 2, 3, 4], [5, 6, 7, 8]])
})

it('lets cancellation drain the stream without waiting for a blocked storage sink or dispatching more chunks to it', async () => {
  const { device, reads } = transfer(), controller = new AbortController()
  let release!: () => void
  const sink = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
  const task = device.downloadFile('meeting.hda', 8, sink, undefined, controller.signal)
  await vi.advanceTimersByTimeAsync(1)
  reads.shift()!(packet([1, 2, 3, 4])); await vi.advanceTimersByTimeAsync(1000)
  controller.abort(); expect(await task).toBe(false)
  const settlement = device.getActiveDownloadSettlement(); let drained = false
  void settlement?.then(() => { drained = true })
  expect(drained).toBe(false)
  reads.shift()!(packet([5, 6, 7, 8])); await vi.advanceTimersByTimeAsync(1060)
  await settlement
  expect(drained).toBe(true); expect(sink).toHaveBeenCalledOnce(); expect(device.isPoisoned()).toBe(false)
  release(); await Promise.resolve()
})

it('drains a failed sink to the file boundary before releasing the USB command slot', async () => {
  const { device, reads, transferOut } = transfer()
  const task = device.downloadFile('meeting.hda', 8, async () => { throw Error('Disk is full') })
  await vi.advanceTimersByTimeAsync(1)
  reads.shift()!(packet([1, 2, 3, 4])); await vi.advanceTimersByTimeAsync(1000)
  expect(await task).toBe(false)
  const settlement = device.getActiveDownloadSettlement(); let drained = false
  void settlement?.then(() => { drained = true })
  expect(drained).toBe(false); expect(transferOut).toHaveBeenCalledOnce()
  reads.shift()!(packet([5, 6, 7, 8])); await vi.advanceTimersByTimeAsync(1060)
  await settlement
  expect(drained).toBe(true); expect(device.isPoisoned()).toBe(false)
})

it('parses a full read-ahead queue immediately rather than throttling a healthy transfer to one batch per second', async () => {
  const { device, reads, transferIn } = transfer()
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  const sink = vi.fn().mockImplementationOnce(() => blocked).mockResolvedValue(undefined)
  const task = device.downloadFile('meeting.hda', 4096, sink)
  await vi.advanceTimersByTimeAsync(1)
  for (let i = 0; i < 4; i++) { reads.shift()!(packet(new Array(1024).fill(i))); await vi.advanceTimersByTimeAsync(0) }
  expect(sink).toHaveBeenCalledOnce(); expect(transferIn).toHaveBeenCalledTimes(4)
  release(); await vi.advanceTimersByTimeAsync(1)
  expect(await task).toBe(true); expect(sink).toHaveBeenCalledTimes(4)
})
