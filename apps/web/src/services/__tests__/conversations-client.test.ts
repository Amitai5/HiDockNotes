import { afterEach, describe, expect, it, vi } from 'vitest'
import { appClient } from '../app-client'

afterEach(() => vi.unstubAllGlobals())
describe('Assistant HTTP serialization', () => {
  it('omits an absent history cursor on a chat refresh', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ result: {} }))
    vi.stubGlobal('fetch', request)

    await appClient.conversations.get('chat-id')
    await appClient.conversations.get('chat-id', undefined)

    expect(request.mock.calls.map(call => JSON.parse(call[1]!.body as string).args)).toEqual([['chat-id'], ['chat-id']])
  })
  it('preserves explicit history cursors, including zero', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ result: {} }))
    vi.stubGlobal('fetch', request)

    await appClient.conversations.get('chat-id', 12)
    await appClient.conversations.get('chat-id', 0)

    expect(request.mock.calls.map(call => JSON.parse(call[1]!.body as string).args)).toEqual([['chat-id', 12], ['chat-id', 0]])
  })
})
