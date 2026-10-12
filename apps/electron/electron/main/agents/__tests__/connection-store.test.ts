import { describe, expect, it, vi } from 'vitest'
import { AgentConnectionStore } from '../connection-store'

function fixture(available = true) {
  let saved = Buffer.alloc(0)
  const file = { read: vi.fn(async () => saved), write: vi.fn(async (value: Buffer) => { saved = value }), remove: vi.fn(async () => { saved = Buffer.alloc(0) }) }
  const encryption = { isAvailable: () => available, encrypt: vi.fn((value: string) => Buffer.from(value).reverse()), decrypt: vi.fn((value: Buffer) => Buffer.from(value).reverse().toString()) }
  return { file, encryption, store: new AgentConnectionStore(file, encryption), saved: () => saved }
}
describe('encrypted local agent connection', () => {
  it('round-trips the connection only through operating-system encryption', async () => {
    const value = fixture()
    const connection = { port: 49152, token: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG' }
    await value.store.save(connection)
    expect(value.saved().toString()).not.toContain(connection.token)
    expect(value.encryption.encrypt).toHaveBeenCalledWith(JSON.stringify(connection))
    expect(await value.store.read()).toEqual(connection)
    await value.store.remove()
    expect(value.file.remove).toHaveBeenCalledOnce()
  })
  it('refuses plaintext fallback when secure storage is unavailable', async () => {
    const value = fixture(false)
    await expect(value.store.save({ port: 49152, token: 'a'.repeat(43) })).rejects.toThrow('Secure operating-system storage')
    expect(value.file.write).not.toHaveBeenCalled()
    await expect(value.store.read()).rejects.toThrow('Secure operating-system storage')
  })
  it.each([{ port: 0, token: 'a'.repeat(43) }, { port: 65536, token: 'a'.repeat(43) }, { port: 42, token: 'bad' }])('rejects malformed discovery without exposing the decrypted content', async connection => {
    const value = fixture()
    await value.store.save(connection)
    await expect(value.store.read()).rejects.toThrow('Enable MCP access')
  })
})
