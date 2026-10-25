import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { fork } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UtilityProcessingRunner } from '../ai/worker-runner'
import { SharedModelPreparation } from '../ai/shared-model-preparation'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'
import type { ProcessingInput, ProcessingResult } from '../ai/backend'
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), fork: vi.fn() }))
const result: ProcessingResult = { segments: [], speakers: [], duration: 1, empty: true, summary: null }
function child() {
  const process = Object.assign(new EventEmitter(), { connected: true, send: vi.fn((message: any) => { if (message.type === 'cancel') process.emit('message', { type: 'error', message: 'Cancelled.', retryable: false }); return true }), kill: vi.fn(() => true) })
  vi.mocked(fork).mockReturnValueOnce(process as unknown as ChildProcess)
  return process
}
const input = (id: string): ProcessingInput => ({ id, path: '/verified/audio', checksum: 'verified', dataPath: '/fixture', keys: { gemini: null, openai: null }, settings: DEFAULT_AI_SETTINGS, profiles: [] })
const observer = () => ({ stage: vi.fn(), checkpoint: vi.fn() })
afterEach(() => vi.clearAllMocks())
describe('parallel isolated processing workers', () => {
  it('routes each worker result and progress to its recording and rejects duplicate workers for one recording', async () => {
    const first = child(), second = child(), runner = new UtilityProcessingRunner(), firstObserver = observer(), secondObserver = observer()
    const one = runner.run(input('one'), firstObserver), two = runner.run(input('two'), secondObserver)
    first.emit('message', { type: 'stage', stage: 'transcribing', progress: 0.5, message: 'One' }); second.emit('message', { type: 'checkpoint', value: result })
    await expect(runner.run(input('one'), observer())).rejects.toThrow('already has')
    expect(firstObserver.stage).toHaveBeenCalledWith('transcribing', 0.5, 'One'); expect(secondObserver.stage).not.toHaveBeenCalled(); expect(secondObserver.checkpoint).toHaveBeenCalledWith(result)
    first.emit('message', { type: 'result', value: result }); second.emit('message', { type: 'result', value: result })
    expect(await one).toEqual(result); expect(await two).toEqual(result); expect(first.kill).toHaveBeenCalledOnce(); expect(second.kill).toHaveBeenCalledOnce()
  })
  it('stops only the specified recording while another worker continues', async () => {
    const first = child(), second = child(), runner = new UtilityProcessingRunner()
    const one = runner.run(input('one'), observer()).catch(error => error), two = runner.run(input('two'), observer())
    await runner.stop('one'); expect((await one).message).toContain('Cancelled'); expect(first.kill).toHaveBeenCalledOnce()
    expect(second.send).not.toHaveBeenCalledWith({ type: 'cancel' }); expect(second.kill).not.toHaveBeenCalled()
    second.emit('message', { type: 'result', value: result }); expect(await two).toEqual(result)
  })
  it('shares model preparation across processes and does not abort another worker when one cancels', async () => {
    let complete!: (value: string) => void, signal!: AbortSignal
    const load = vi.fn((_path, _kind, _progress, pendingSignal) => { signal = pendingSignal; return new Promise<string>(resolve => { complete = resolve }) })
    const first = child(), second = child(), runner = new UtilityProcessingRunner(undefined, new SharedModelPreparation(load))
    const one = runner.run(input('one'), observer()).catch(error => error), two = runner.run(input('two'), observer())
    first.emit('message', { type: 'models', kind: 'speech', requestId: 'a' }); second.emit('message', { type: 'models', kind: 'speech', requestId: 'b' })
    await Promise.resolve(); expect(load).toHaveBeenCalledOnce()
    await runner.stop('one'); await one; expect(signal.aborted).toBe(false)
    complete('/fixture/models/speech.onnx'); await vi.waitFor(() => expect(second.send).toHaveBeenCalledWith({ type: 'models-result', requestId: 'b', value: '/fixture/models/speech.onnx' }))
    expect(first.send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'models-result', value: '/fixture/models/speech.onnx' }))
    second.emit('message', { type: 'result', value: result }); await two
  })
  it('stops and drains all workers on server shutdown', async () => {
    const first = child(), second = child(), runner = new UtilityProcessingRunner()
    const one = runner.run(input('one'), observer()).catch(error => error), two = runner.run(input('two'), observer()).catch(error => error)
    await runner.stop(); await one; await two
    expect(first.send).toHaveBeenCalledWith({ type: 'cancel' }); expect(second.send).toHaveBeenCalledWith({ type: 'cancel' })
  })
})
