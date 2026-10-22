import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { downloadSearchModel, hasSearchModel } from '../search/semantic-model'

let folder: string
beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), 'hidocknotes-search-model-')) })
afterEach(async () => { await rm(folder, { recursive: true, force: true }) })
describe('verified optional model downloads', () => {
  it('rejects incorrect bytes while preserving an existing file and removing incomplete staging', async () => {
    const previous = Buffer.from('previous model configuration'); await writeFile(join(folder, 'config.json'), previous)
    const request = vi.fn(async () => new Response(new Uint8Array(650)))
    await expect(downloadSearchModel(folder, vi.fn(), new AbortController().signal, request)).rejects.toThrow('failed verification')
    expect(await readFile(join(folder, 'config.json'))).toEqual(previous)
    expect((await readdir(folder)).filter(name => name.endsWith('.partial'))).toEqual([])
    expect(await hasSearchModel(folder)).toBe(false)
  })
  it('rejects truncated and oversized responses', async () => {
    await expect(downloadSearchModel(folder, vi.fn(), new AbortController().signal, vi.fn(async () => new Response(new Uint8Array(12))))).rejects.toThrow('failed verification')
    await expect(downloadSearchModel(folder, vi.fn(), new AbortController().signal, vi.fn(async () => new Response(new Uint8Array(651))))).rejects.toThrow('expected size')
    expect((await readdir(folder)).filter(name => name.endsWith('.partial'))).toEqual([])
  })
  it('honors cancellation before making any network request', async () => {
    const controller = new AbortController(); controller.abort()
    const request = vi.fn()
    await expect(downloadSearchModel(folder, vi.fn(), controller.signal, request)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
