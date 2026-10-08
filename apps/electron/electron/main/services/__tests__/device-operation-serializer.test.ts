import { describe, expect, it } from 'vitest'
import { serializeDeviceOperation } from '../device-operation-serializer'

describe('device operation serializer', () => {
  it('holds the slot until the complete operation settles', async () => {
    const events: string[] = []
    let release!: () => void
    const drain = new Promise<void>(resolve => { release = resolve })
    const first = serializeDeviceOperation(async () => { events.push('download'); await drain; events.push('drained') })
    const second = serializeDeviceOperation(async () => { events.push('next-command') })
    await Promise.resolve()
    expect(events).toEqual(['download'])
    release()
    await Promise.all([first, second])
    expect(events).toEqual(['download', 'drained', 'next-command'])
  })
  it('allows a later command after an operation rejects', async () => {
    await expect(serializeDeviceOperation(async () => { throw new Error('USB failed') })).rejects.toThrow('USB failed')
    await expect(serializeDeviceOperation(async () => 42)).resolves.toBe(42)
  })
})
