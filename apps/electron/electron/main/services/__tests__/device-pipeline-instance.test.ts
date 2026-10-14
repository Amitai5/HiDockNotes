import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ raw: {} as Record<string, unknown> }))
vi.mock('../jensen', () => ({ getJensenDevice: () => fixture.raw, webusb: {}, USB_VENDOR_IDS: [1] }))
vi.mock('../download-service', () => ({ getDownloadService: () => ({ setFileVerifier: vi.fn(), getFilesToSyncBatched: vi.fn(async () => []), processDownload: vi.fn(), cancelActiveDownloads: vi.fn(), getState: () => ({ queue: [] }) }) }))
vi.mock('../config', () => ({ getConfig: () => ({ device: { autoDownload: false } }) }))
vi.mock('../database', () => ({ getRecordingByFilename: vi.fn(), queryOne: vi.fn(), run: vi.fn(), runInTransaction: (fn: () => void) => fn() }))
vi.mock('../file-verification', () => ({ hasVerifiedCopy: vi.fn(async () => true), verifySavedFile: vi.fn(), verifyDownloadedBytes: vi.fn() }))
vi.mock('../activity-log', () => ({ emitActivityLog: vi.fn() }))
vi.mock('../recording-events', () => ({ recordingReady: vi.fn() }))
import { __resetDevicePipelineServiceForTests, getDevicePipelineService } from '../device-pipeline-instance'

beforeEach(() => {
  __resetDevicePipelineServiceForTests()
  fixture.raw = { isConnected: vi.fn(() => false), connect: vi.fn(), getModel: () => 'hidock-p1', getDeviceInfo: vi.fn(async () => ({ serialNumber: 'original', versionCode: '1.4.5' })), getCardInfo: vi.fn(async () => null), getFileCount: vi.fn(async () => ({ count: 0 })), getSettings: vi.fn(async () => ({ autoRecord: false })), getTime: vi.fn(async () => null), getBatteryStatus: vi.fn(async () => ({ batteryLevel: 100 })), getRecordingFile: vi.fn(async () => ({ recording: null })), listFiles: vi.fn(async () => []), disconnect: vi.fn(async () => undefined) }
})
describe('native connection lifecycle binding', () => {
  it('does not abort a fresh connection when Jensen performs its normal pre-connect cleanup', async () => {
    let signal: AbortSignal | undefined
    vi.mocked(fixture.raw.connect as (signal?: AbortSignal) => Promise<boolean>).mockImplementation(async value => {
      signal = value
      ;(fixture.raw.ondisconnect as (reason: string) => void)('cleanup')
      vi.mocked(fixture.raw.isConnected as () => boolean).mockReturnValue(true)
      return true
    })
    const pipeline = getDevicePipelineService()
    expect(await pipeline.connect()).toBe(true)
    expect(signal?.aborted).toBe(false)
    expect(pipeline.getState().phase).toBe('idle')
    expect(fixture.raw.listFiles).toHaveBeenCalledOnce()
  })
  it('still cancels immediately on a physical unplug during connection and never publishes ready metadata', async () => {
    vi.mocked(fixture.raw.connect as (signal?: AbortSignal) => Promise<boolean>).mockImplementation(async signal => {
      ;(fixture.raw.ondisconnect as (reason: string) => void)('physical')
      expect(signal?.aborted).toBe(true)
      return true
    })
    const pipeline = getDevicePipelineService()
    expect(await pipeline.connect()).toBe(false)
    expect(pipeline.getState()).toMatchObject({ phase: 'disconnected', device: null })
    expect(fixture.raw.getDeviceInfo).not.toHaveBeenCalled()
    expect(fixture.raw.listFiles).not.toHaveBeenCalled()
  })
  it('preserves disconnected state and stops metadata reads when unplugged during initialization', async () => {
    vi.mocked(fixture.raw.connect as () => Promise<boolean>).mockImplementation(async () => { vi.mocked(fixture.raw.isConnected as () => boolean).mockReturnValue(true); return true })
    vi.mocked(fixture.raw.getDeviceInfo as () => Promise<unknown>).mockImplementation(async () => {
      vi.mocked(fixture.raw.isConnected as () => boolean).mockReturnValue(false)
      ;(fixture.raw.ondisconnect as (reason: string) => void)('physical')
      return { serialNumber: 'original', versionCode: '1.4.5' }
    })
    const pipeline = getDevicePipelineService()
    expect(await pipeline.connect()).toBe(false)
    expect(pipeline.getState()).toMatchObject({ phase: 'disconnected', device: null })
    expect(fixture.raw.getCardInfo).not.toHaveBeenCalled()
    expect(fixture.raw.listFiles).not.toHaveBeenCalled()
  })
})
