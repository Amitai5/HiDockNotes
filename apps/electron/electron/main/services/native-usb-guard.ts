import { EP_IN } from '@hidock/jensen-protocol'

interface NativeBinding { device?: { interface(index: number): { endpoint(address: number): { startPoll?: unknown; stopPoll?: unknown } } } }
/** Require cancellable native reads before starting the protocol; port reset is never an application recovery path. */
export function guardNativeUsb(backend: USB): USB {
  const guarded = new WeakMap<USBDevice, USBDevice>()
  function wrap(device: USBDevice): USBDevice {
    const existing = guarded.get(device)
    if (existing) return existing
    const proxy = new Proxy(device, {
      get(target, key) {
        if (key === 'open') return async () => {
          await target.open()
          try {
            const endpoint = (target as unknown as NativeBinding).device?.interface(0).endpoint(EP_IN)
            if (typeof endpoint?.startPoll !== 'function' || typeof endpoint.stopPoll !== 'function') throw new Error('This USB backend cannot drain safely. Install the supported node-usb backend.')
          } catch (error) { await target.close(); throw error }
        }
        if (key === 'reset') return async () => { throw new Error('USB reset is disabled. Use a graceful disconnect.') }
        const value: unknown = Reflect.get(target, key, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    guarded.set(device, proxy)
    return proxy
  }
  return new Proxy(backend, {
    get(target, key) {
      if (key === 'getDevices') return async () => (await target.getDevices()).map(wrap)
      if (key === 'requestDevice') return async (options: USBDeviceRequestOptions) => wrap(await target.requestDevice(options))
      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
