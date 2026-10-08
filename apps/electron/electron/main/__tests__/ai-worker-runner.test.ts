import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UtilityProcessingRunner } from '../ai/worker-runner'
import type { ProcessingInput } from '../ai/backend'

const mocks = vi.hoisted(() => ({ fork: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: mocks.fork } }))
afterEach(() => vi.useRealTimers())
function child(): EventEmitter & { postMessage: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> } {
  const worker = Object.assign(new EventEmitter(), { postMessage: vi.fn(), kill: vi.fn() })
  worker.kill.mockImplementation(() => { worker.emit('exit', 0); return true })
  return worker
}
describe('isolated transcription worker', () => {
  it('uses an isolated utility process, forwards stage and checkpoint events, and closes after completion', async () => {
    const worker = child(); mocks.fork.mockReturnValue(worker)
    const runner = new UtilityProcessingRunner(), stage = vi.fn(), checkpoint = vi.fn()
    const task = runner.run({ id: 'recording' } as ProcessingInput, { stage, checkpoint })
    worker.emit('spawn'); worker.emit('message', { type: 'stage', stage: 'converting', progress: 0, message: 'Converting' }); worker.emit('message', { type: 'checkpoint', value: { segments: [], speakers: [], duration: 1 } }); worker.emit('message', { type: 'result', value: { empty: true, segments: [], speakers: [], duration: 1, summary: null } })
    expect((await task).empty).toBe(true)
    expect(mocks.fork.mock.calls[0][2]).toMatchObject({ stdio: 'ignore' })
    expect(stage).toHaveBeenCalledWith('converting', 0, 'Converting')
    expect(checkpoint).toHaveBeenCalledOnce()
    expect(worker.kill).toHaveBeenCalledOnce()
  })
  it('turns native crashes into retryable failures without leaving a worker slot occupied', async () => {
    const worker = child(); mocks.fork.mockReturnValue(worker)
    const runner = new UtilityProcessingRunner()
    const task = runner.run({} as ProcessingInput, { stage: vi.fn(), checkpoint: vi.fn() })
    const failure = expect(task).rejects.toMatchObject({ retryable: true })
    worker.emit('exit', 1)
    await failure
    expect(worker.kill).toHaveBeenCalled()
  })
  it('cancels CPU and AI work on quit, independently of USB shutdown', async () => {
    vi.useFakeTimers()
    const worker = child(); mocks.fork.mockReturnValue(worker)
    const runner = new UtilityProcessingRunner()
    const task = runner.run({} as ProcessingInput, { stage: vi.fn(), checkpoint: vi.fn() }).catch(() => undefined)
    const stop = runner.stop()
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
    await vi.advanceTimersByTimeAsync(3000)
    await stop; await task
    expect(worker.kill).toHaveBeenCalled()
  })
  it('releases a worker that never starts so the persistent queue can retry', async () => {
    vi.useFakeTimers()
    const worker = child(); mocks.fork.mockReturnValue(worker)
    const runner = new UtilityProcessingRunner()
    const task = runner.run({} as ProcessingInput, { stage: vi.fn(), checkpoint: vi.fn() })
    const rejected = expect(task).rejects.toMatchObject({ retryable: true, message: expect.stringContaining('did not start') })
    await vi.advanceTimersByTimeAsync(30000)
    await rejected
    expect(worker.kill).toHaveBeenCalledOnce()
  })
  it('does not time out a ready worker performing long local CPU work', async () => {
    vi.useFakeTimers()
    const worker = child(); mocks.fork.mockReturnValue(worker)
    const runner = new UtilityProcessingRunner()
    const task = runner.run({} as ProcessingInput, { stage: vi.fn(), checkpoint: vi.fn() })
    worker.emit('message', { type: 'ready' })
    await vi.advanceTimersByTimeAsync(60000)
    expect(worker.kill).not.toHaveBeenCalled()
    worker.emit('message', { type: 'result', value: { empty: true } })
    expect((await task).empty).toBe(true)
  })
})
