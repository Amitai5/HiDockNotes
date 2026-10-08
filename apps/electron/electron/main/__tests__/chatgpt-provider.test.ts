import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { ChatGPTProvider } from '../ai/chatgpt-provider'
import { ChatGPTPlanBlocked } from '../ai/chatgpt-protocol'
import { DEFAULT_AI_SETTINGS } from '../../../src/shared/ai'

function mockClient(events: unknown[]): { client: OpenAI; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn(async () => (async function* () { for (const event of events) yield event })())
  return { client: { responses: { create } } as unknown as OpenAI, create }
}
const completed = (text: string): unknown => ({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } })
describe('subscription Responses provider', () => {
  it('uses the public supported streaming contract and renews credentials for every request', async () => {
    const { client, create } = mockClient([{ type: 'response.output_text.delta', delta: 'Partial' }, completed('Final answer [1]')])
    const getToken = vi.fn().mockResolvedValueOnce('first-access').mockResolvedValueOnce('renewed-access')
    const factory = vi.fn(() => client)
    const provider = new ChatGPTProvider(getToken, factory)
    expect(await provider.chat('gpt-6.1-sol', 'Use transcript evidence.', 'Evidence')).toBe('Final answer [1]')
    await provider.chat('gpt-6.1-sol', 'Use transcript evidence.', 'Evidence two')
    expect(factory.mock.calls).toEqual([['first-access'], ['renewed-access']])
    const body = create.mock.calls[0][0]
    expect(body).toMatchObject({ model: 'gpt-6.1-sol', store: false, stream: true, instructions: 'Use transcript evidence.', input: [{ role: 'user', content: 'Evidence' }] })
    for (const forbidden of ['max_output_tokens', 'previous_response_id', 'background', 'conversation', 'temperature', 'prompt', 'tools']) expect(body).not.toHaveProperty(forbidden)
  })
  it('creates timestamped action items using streamed structured summaries', async () => {
    const text = JSON.stringify({ title: 'Plan', summary: 'Dana will send the plan.', actionItems: [{ text: 'Send the plan', start: 4 }] })
    const { client, create } = mockClient([completed(text)])
    const provider = new ChatGPTProvider(async () => 'access', () => client)
    const result = await provider.summarize('gpt-6.1-sol', [{ id: 'one', start: 4, end: 9, text: 'I will send the plan.', speakerId: null, speakerName: 'Dana' }], DEFAULT_AI_SETTINGS)
    expect(result.actionItems).toEqual([{ text: 'Send the plan', start: 4 }])
    expect(create.mock.calls[0][0]).toMatchObject({ text: { format: { type: 'json_schema', strict: true } } })
  })
  it.each([[{ type: 'response.output_text.delta', delta: 'Unfinished' }], [{ type: 'response.incomplete', response: {} }]])('rejects incomplete streams instead of persisting partial answers', async events => {
    const { client } = mockClient(events)
    await expect(new ChatGPTProvider(async () => 'access', () => client).chat('model', 'instructions', 'input')).rejects.toThrow(/complete|incomplete/)
  })
  it('pauses plan requests when a usage error arrives after text deltas', async () => {
    const { client } = mockClient([{ type: 'response.output_text.delta', delta: 'Unfinished' }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])
    const blocked = vi.fn()
    const provider = new ChatGPTProvider(async () => 'access', () => client, blocked)
    await expect(provider.chat('model', 'instructions', 'input')).rejects.toBeInstanceOf(ChatGPTPlanBlocked)
    expect(blocked).toHaveBeenCalledWith(expect.stringContaining('Manage usage'))
  })
  it('rejects audio without reading credentials or calling a cloud endpoint', async () => {
    const token = vi.fn(async () => 'access'), factory = vi.fn()
    await expect(new ChatGPTProvider(token, factory).transcribe('model', { path: '/private/audio', duration: 10, language: 'auto' })).rejects.toThrow('does not support audio')
    expect(token).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled()
  })
  it('sanitizes SDK exceptions including secret response bodies and URLs', async () => {
    const create = vi.fn().mockRejectedValue({ status: 401, message: 'https://private.example?token=secret' })
    const provider = new ChatGPTProvider(async () => 'access', () => ({ responses: { create } }) as unknown as OpenAI)
    await expect(provider.chat('model', 'instructions', 'input')).rejects.toThrow('session expired')
    await expect(provider.chat('model', 'instructions', 'input')).rejects.not.toThrow('secret')
  })
})
