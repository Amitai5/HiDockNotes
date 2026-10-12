import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentAccessController } from '../controller'
import { AgentConnectionStore } from '../connection-store'

const gateway = vi.hoisted(() => ({ start: vi.fn(), close: vi.fn() }))
vi.mock('../gateway', () => ({ AgentGateway: class { start = gateway.start; close = gateway.close } }))
beforeEach(() => { gateway.start.mockReset().mockResolvedValue({ port: 42, token: 'a'.repeat(43) }); gateway.close.mockReset().mockResolvedValue(undefined) })
function fixture(enabled = false, available = true) {
  const file = { read: vi.fn(), write: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
  const saveEnabled = vi.fn()
  const controller = new AgentAccessController({ readEnabled: () => enabled, saveEnabled, store: new AgentConnectionStore(file, { isAvailable: () => available, encrypt: value => Buffer.from(value).reverse(), decrypt: value => value.reverse().toString() }), call: vi.fn(), setup: { codex: '', claude: '', other: '' } })
  return { controller, file, saveEnabled }
}
describe('agent connection lifecycle', () => {
  it('does not listen until explicitly enabled and deletes stale encrypted discovery', async () => {
    const value = fixture()
    expect(await value.controller.start()).toMatchObject({ enabled: false, running: false, error: null })
    expect(gateway.start).not.toHaveBeenCalled()
    expect(value.file.remove).toHaveBeenCalledOnce()
  })
  it('persists opt-in and serializes a rapid enable then disable', async () => {
    const value = fixture()
    const first = value.controller.setEnabled(true)
    const second = value.controller.setEnabled(false)
    expect(await first).toMatchObject({ enabled: true, running: true })
    expect(await second).toMatchObject({ enabled: false, running: false })
    expect(value.saveEnabled.mock.calls).toEqual([[true], [false]])
    expect(gateway.start).toHaveBeenCalledOnce()
    expect(value.file.write).toHaveBeenCalledOnce()
    expect(gateway.close).toHaveBeenCalledOnce()
    expect(value.file.remove).toHaveBeenCalledOnce()
  })
  it('closes a listening gateway if encrypted discovery cannot be saved', async () => {
    const value = fixture(true, false)
    expect(await value.controller.start()).toMatchObject({ enabled: true, running: false, error: expect.stringContaining('could not start securely') })
    expect(gateway.close).toHaveBeenCalledOnce()
    expect(value.file.write).not.toHaveBeenCalled()
  })
  it('closes and removes the credential before application shutdown', async () => {
    const value = fixture(true)
    await value.controller.start()
    await value.controller.close()
    expect(value.controller.state().running).toBe(false)
    expect(value.file.remove).toHaveBeenCalledOnce()
  })
})
