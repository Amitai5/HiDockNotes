import { describe, expect, it, vi } from 'vitest'
import { ModelCache } from '../ai/model-cache'

const mocks = vi.hoisted(() => ({ rm: vi.fn(), mkdir: vi.fn(), rename: vi.fn() }))
vi.mock('node:fs/promises', () => ({ ...mocks, writeFile: vi.fn(), readFile: vi.fn() }))
vi.mock('node:fs', async () => { const { Writable } = await import('node:stream'); return { createReadStream: () => { throw new Error('No cached model') }, createWriteStream: () => new Writable({ write(_chunk, _encoding, callback) { callback() } }) } })
describe('first-use model download protection', () => {
  it('reports an unavailable official release and removes partial downloads', async () => {
    const request = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }))
    await expect(new ModelCache('/models', request).ensure(vi.fn())).rejects.toThrow('official release')
    expect(request.mock.calls[0][0]).toContain('github.com/k2-fsa/sherpa-onnx/releases/')
    expect(mocks.rename).not.toHaveBeenCalled()
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining('.partial'), { force: true })
  })
  it('blocks truncated model bytes before extraction or publishing', async () => {
    const request = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])))
    await expect(new ModelCache('/models', request).ensure(vi.fn())).rejects.toThrow('incomplete')
    expect(mocks.rename).not.toHaveBeenCalled()
  })
})
