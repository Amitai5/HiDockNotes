import { afterEach, describe, expect, it, vi } from 'vitest'
import { appClient } from '../app-client'

afterEach(() => vi.unstubAllGlobals())
describe('written-note HTTP serialization', () => {
  it('omits an absent revision instead of serializing it as null in RPC arguments', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ result: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', request)
    await appClient.notes.get('note-id')
    expect(JSON.parse(request.mock.calls[0][1].body as string).args).toEqual(['note-id'])
    await appClient.notes.get('note-id', 3)
    expect(JSON.parse(request.mock.calls[1][1].body as string).args).toEqual(['note-id', 3])
  })
  it('sends empty objects for omitted note-list and mixed-library options', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ result: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', request)
    await appClient.notes.list(); await appClient.library.content()
    expect(request.mock.calls.map(call => JSON.parse(call[1].body as string).args)).toEqual([[{}], [{}]])
  })
})
