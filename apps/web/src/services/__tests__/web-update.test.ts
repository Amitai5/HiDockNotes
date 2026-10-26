import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateWebUpdate } from '../web-update'

class Worker extends EventTarget {
  state: ServiceWorkerState = 'installed'
  postMessage = vi.fn()
  setState(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')) }
}
const registration = (waiting: Worker | null, active: Worker | null = null, installing: Worker | null = null) => ({ waiting, active, installing }) as unknown as ServiceWorkerRegistration
afterEach(() => vi.useRealTimers())
describe('activating a web interface update', () => {
  it('waits for the chosen worker to activate instead of depending on a controlling event', async () => {
    const waiting = new Worker(), result = vi.fn(), task = activateWebUpdate(registration(waiting)).then(result)
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    await Promise.resolve(); expect(result).not.toHaveBeenCalled()
    waiting.setState('activating'); await Promise.resolve(); expect(result).not.toHaveBeenCalled()
    waiting.setState('activated'); await task; expect(result).toHaveBeenCalledOnce()
  })
  it('accepts an already activated worker when another tab consumed the waiting update', async () => {
    const active = new Worker(); active.setState('activated')
    await expect(activateWebUpdate(registration(null, active))).resolves.toBeUndefined()
    expect(active.postMessage).not.toHaveBeenCalled()
  })
  it('waits for an in-flight activation with no waiting worker', async () => {
    const active = new Worker(); active.setState('activating')
    const task = activateWebUpdate(registration(null, active))
    active.setState('activated'); await task; expect(active.postMessage).not.toHaveBeenCalled()
  })
  it('can request activation while the new worker is finishing installation', async () => {
    const installing = new Worker(); installing.setState('installing')
    const task = activateWebUpdate(registration(null, null, installing))
    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    installing.setState('activated'); await task
  })
  it('returns a retryable timeout instead of leaving the button spinning forever', async () => {
    vi.useFakeTimers()
    const waiting = new Worker(), remove = vi.spyOn(waiting, 'removeEventListener')
    const task = expect(activateWebUpdate(registration(waiting))).rejects.toThrow('did not finish')
    await vi.advanceTimersByTimeAsync(15000); await task
    expect(remove).toHaveBeenCalledWith('statechange', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cleans up if the waiting worker becomes redundant or cannot receive a message', async () => {
    const waiting = new Worker(), task = activateWebUpdate(registration(waiting))
    waiting.setState('redundant'); await expect(task).rejects.toThrow('changed')
    waiting.postMessage.mockImplementation(() => { throw Error('Unavailable worker') }); waiting.setState('installed')
    await expect(activateWebUpdate(registration(waiting))).rejects.toThrow('Unavailable worker')
  })
  it('reports a missing registration instead of silently doing nothing', async () => {
    await expect(activateWebUpdate(undefined)).rejects.toThrow('Reload this page')
    await expect(activateWebUpdate(registration(null))).rejects.toThrow('Reload this page')
  })
})
