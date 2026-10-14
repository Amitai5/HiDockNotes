import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerAIHandlers } from '../ai-handlers'
import type { TranscriptionQueue } from '../../ai/queue'
import type { ChatGPTAuth } from '../../ai/chatgpt-auth'
import { CredentialVault } from '../../ai/credentials'
import type { ProviderFactory } from '../../ai/providers'
import { closeDatabase, initializeDatabase } from '../../services/database'
import { readAISettings, updateAISettings } from '../../ai/settings'
import { DEFAULT_CHATGPT_MODELS } from '../../../../src/shared/ai'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('../trusted-ipc', () => ({ handle: (name: string, callback: (...args: unknown[]) => unknown) => handlers.set(name, callback) }))

describe('saved ChatGPT account removal IPC', () => {
  const id = '33333333-3333-4333-8333-333333333333'
  const remove = vi.fn(), kick = vi.fn(), changed = vi.fn()
  beforeEach(() => {
    initializeDatabase(':memory:'); handlers.clear(); remove.mockReset().mockResolvedValue(null); kick.mockReset(); changed.mockReset()
    const queue = { state: vi.fn(() => ({ ready: true })), kick } as unknown as TranscriptionQueue
    const chatgpt = { remove, state: () => ({ models: DEFAULT_CHATGPT_MODELS }) } as unknown as ChatGPTAuth
    const vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    registerAIHandlers(queue, vault, vi.fn() as unknown as ProviderFactory, changed, chatgpt, vi.fn())
  })
  afterEach(closeDatabase)
  it('requires true confirmation and a valid profile ID before removing credentials', async () => {
    const invoke = handlers.get('chatgpt:remove')!
    await expect(Promise.resolve().then(() => invoke(id, false))).rejects.toThrow('Confirm')
    await expect(Promise.resolve().then(() => invoke(id, 'true'))).rejects.toThrow()
    await expect(Promise.resolve().then(() => invoke('../profile', true))).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
    expect(kick).not.toHaveBeenCalled()
  })
  it('returns updated state and adapts an unavailable model to the replacement account', async () => {
    updateAISettings({ chat: { provider: 'chatgpt', model: 'saved-account-model' } })
    expect(await handlers.get('chatgpt:remove')!(id, true)).toEqual({ state: { ready: true }, message: null })
    expect(remove).toHaveBeenCalledExactlyOnceWith(id)
    expect(readAISettings().chat).toEqual({ provider: 'chatgpt', model: DEFAULT_CHATGPT_MODELS[0].id })
    expect(kick).toHaveBeenCalledOnce(); expect(changed).toHaveBeenCalledOnce()
  })
})
