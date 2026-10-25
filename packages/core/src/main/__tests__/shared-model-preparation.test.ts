import { describe, expect, it, vi } from 'vitest'
import { SharedModelPreparation, type PreparedModel } from '../ai/shared-model-preparation'

describe('shared server model preparation', () => {
  it('shares preparation and progress across workers while keeping model kinds separate', async () => {
    let ready!: (value: PreparedModel) => void, progress!: (message: string) => void
    const load = vi.fn((_path, _kind, report) => { progress = report; return new Promise<PreparedModel>(resolve => { ready = resolve }) })
    const models = new SharedModelPreparation(load), firstProgress = vi.fn(), secondProgress = vi.fn()
    const first = models.prepare('/data', 'speech', firstProgress, new AbortController().signal), second = models.prepare('/data', 'speech', secondProgress, new AbortController().signal)
    await Promise.resolve(); expect(load).toHaveBeenCalledOnce()
    progress('Downloading speech'); expect(firstProgress).toHaveBeenCalledWith('Downloading speech', undefined); expect(secondProgress).toHaveBeenCalledWith('Downloading speech', undefined)
    ready('/data/models/speech.onnx'); expect(await first).toBe('/data/models/speech.onnx'); expect(await second).toBe('/data/models/speech.onnx')
    load.mockResolvedValueOnce('/data/models/other.onnx')
    expect(await models.prepare('/data', 'speakers', vi.fn(), new AbortController().signal)).toBe('/data/models/other.onnx')
    expect(load).toHaveBeenCalledTimes(2)
  })
  it('lets one job cancel without aborting another job using the same model preparation', async () => {
    let finish!: (value: PreparedModel) => void, sharedSignal!: AbortSignal
    const models = new SharedModelPreparation(vi.fn((_path, _kind, _progress, signal) => { sharedSignal = signal; return new Promise(resolve => { finish = resolve }) }))
    const cancelled = new AbortController()
    const first = models.prepare('/data', 'speech', vi.fn(), cancelled.signal).catch(error => error), second = models.prepare('/data', 'speech', vi.fn(), new AbortController().signal)
    await Promise.resolve(); cancelled.abort(); expect((await first).name).toBe('AbortError'); expect(sharedSignal.aborted).toBe(false)
    finish('/data/model'); expect(await second).toBe('/data/model')
  })
  it('aborts a download after its last waiter cancels and allows a fresh attempt', async () => {
    let signal!: AbortSignal
    const load = vi.fn((_path, _kind, _progress, pendingSignal: AbortSignal) => { signal = pendingSignal; return new Promise<PreparedModel>((_resolve, reject) => pendingSignal.addEventListener('abort', () => reject(pendingSignal.reason), { once: true })) })
    const models = new SharedModelPreparation(load), controller = new AbortController()
    const pending = models.prepare('/data', 'whisper-small', vi.fn(), controller.signal).catch(error => error)
    await Promise.resolve(); controller.abort(); await pending; await models.drain(); expect(signal.aborted).toBe(true)
    load.mockResolvedValueOnce('/data/verified-model'); expect(await models.prepare('/data', 'whisper-small', vi.fn(), new AbortController().signal)).toBe('/data/verified-model')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
