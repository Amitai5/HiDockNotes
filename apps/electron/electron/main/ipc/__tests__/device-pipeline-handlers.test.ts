import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ pipeline: null as unknown, emit: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../../services/device-pipeline-instance', () => ({ getDevicePipelineService: () => fixture.pipeline, projectDeviceFiles: () => [] }))
vi.mock('../../services/download-service', () => ({ getDownloadService: () => ({ getState: () => ({ queue: [] }) }) }))
vi.mock('../../services/activity-log', () => ({ emitActivityLog: fixture.emit }))
vi.mock('../trusted-ipc', () => ({ handle: vi.fn() }))
import { registerDevicePipelineHandlers } from '../device-pipeline-handlers'

beforeEach(() => { fixture.emit.mockClear(); fixture.pipeline = Object.assign(new EventEmitter(), { getState: () => ({ phase: 'disconnected' }) }) })
describe('recorder activity visibility', () => {
  it('logs real phase transitions once without flooding the log on progress updates', () => {
    registerDevicePipelineHandlers()
    const pipeline = fixture.pipeline as EventEmitter
    for (const phase of ['connecting', 'initializing', 'initializing', 'scanning', 'scanning', 'reconciling', 'idle']) pipeline.emit('state', { phase })
    expect(fixture.emit.mock.calls.map(call => call[1])).toEqual(['Connecting to the recorder…', 'Reading recorder information…', 'Reading the recorder file list…', 'Checking which recordings are already downloaded…', 'Recorder is ready.'])
  })
})
