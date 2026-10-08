import { describe, expect, it, vi } from 'vitest'
import { guardNativeUsb } from '../native-usb-guard'

describe('native USB safety boundary', () => {
  function backend(native: unknown) {
    const device = { device: native, open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), reset: vi.fn(), vendorId: 0x10d6 } as unknown as USBDevice
    const usb = { getDevices: vi.fn().mockResolvedValue([device]), requestDevice: vi.fn().mockResolvedValue(device) } as unknown as USB
    return { device, usb: guardNativeUsb(usb) }
  }
  it('permits a native endpoint that can cancel and drain reads', async () => {
    const { device, usb } = backend({ interface: () => ({ endpoint: () => ({ startPoll() {}, stopPoll() {} }) }) })
    const [guarded] = await usb.getDevices()
    await guarded.open()
    expect(device.open).toHaveBeenCalledOnce()
    expect(device.close).not.toHaveBeenCalled()
  })
  it('refuses an unsafe backend before the protocol sends any command', async () => {
    const { device, usb } = backend(undefined)
    await expect((await usb.requestDevice({ filters: [] })).open()).rejects.toThrow('cannot drain safely')
    expect(device.close).toHaveBeenCalledOnce()
    expect(device.reset).not.toHaveBeenCalled()
  })
  it('blocks the port reset escape path', async () => {
    const { device, usb } = backend({})
    const [guarded] = await usb.getDevices()
    await expect(guarded.reset()).rejects.toThrow('reset is disabled')
    expect(device.reset).not.toHaveBeenCalled()
  })
})
