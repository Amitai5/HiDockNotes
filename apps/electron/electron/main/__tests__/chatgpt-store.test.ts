import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initializeDatabase, queryOne } from '../services/database'
import { ChatGPTStore } from '../ai/chatgpt-store'
import { CHATGPT_ISSUER, type ChatGPTTokens } from '../ai/chatgpt-protocol'

const now = Date.parse('2026-10-08T10:00:00Z')
const encryption = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(Array.from(Buffer.from(value)).map(byte => byte ^ 0xa5)), decrypt: (value: Buffer) => Buffer.from(Array.from(value).map(byte => byte ^ 0xa5)).toString() }
const identity = { issuer: CHATGPT_ISSUER, subject: 'subject-one', email: 'same@example.com', name: 'Amitai' }
const tokens: ChatGPTTokens = { accessToken: 'secret-access', refreshToken: 'secret-refresh', idToken: 'secret-identity', expiresAt: now + 3600000, earliestRefreshAt: null, scopes: ['openid', 'resource.invoke', 'chatgpt.tokens.use.direct'] }
describe('protected ChatGPT registration storage', () => {
  let store: ChatGPTStore
  beforeEach(() => { initializeDatabase(':memory:'); store = new ChatGPTStore(encryption) })
  afterEach(closeDatabase)
  it('persists a stable installation host ID and encrypts every token', () => {
    const host = store.hostId(), id = store.save('oaiapp_one', identity, tokens)
    expect(new ChatGPTStore(encryption).hostId()).toBe(host)
    const row = queryOne<{ ciphertext: Buffer }>('SELECT ciphertext FROM chatgpt_profiles')!
    for (const secret of [tokens.accessToken, tokens.refreshToken!, tokens.idToken]) expect(row.ciphertext.includes(Buffer.from(secret))).toBe(false)
    expect(store.tokens(id)).toEqual(tokens)
    expect(JSON.stringify(store.profiles(now))).not.toContain('secret-')
    expect(store.activeId()).toBe(id)
  })
  it('keeps registrations with identical emails separate and preserves account mapping after sign-out', () => {
    const first = store.save('oaiapp_one', identity, tokens)
    const second = store.save('oaiapp_two', { ...identity, subject: 'subject-two' }, { ...tokens, accessToken: 'other-access' })
    expect(store.profiles(now)).toHaveLength(2)
    store.select(first); store.clearTokens(first)
    expect(store.tokens(first)).toBeNull()
    expect(store.tokens(second)?.accessToken).toBe('other-access')
    expect(store.registration(first)).toMatchObject({ clientId: 'oaiapp_one', subject: 'subject-one' })
    expect(store.save('oaiapp_one', identity, tokens)).toBe(first)
    expect(() => store.save('oaiapp_one', { ...identity, subject: 'changed' }, tokens)).toThrow('different account')
  })
  it('retains identity-only sign-in without authorizing plan inference', () => {
    store.save('oaiapp_one', identity, { ...tokens, scopes: ['openid', 'profile', 'email'] })
    expect(store.profiles(now)[0]).toMatchObject({ connected: true, planEnabled: false })
  })
  it('persists usage pauses and only shows the welcome once per connection', () => {
    const id = store.save('oaiapp_one', identity, tokens)
    expect(store.welcomePending(id)).toBe(true)
    store.acknowledgeWelcome(id); store.block(id, 'Usage paused.')
    const reopened = new ChatGPTStore(encryption)
    expect(reopened.welcomePending(id)).toBe(false)
    expect(reopened.blockedReason(id)).toBe('Usage paused.')
    reopened.resume(id)
    expect(store.blockedReason(id)).toBeNull()
  })
  it('never falls back to plaintext and marks an expired non-renewable session disconnected', () => {
    expect(() => new ChatGPTStore({ ...encryption, isAvailable: () => false }).save('oaiapp_one', identity, tokens)).toThrow('storage')
    expect(queryOne('SELECT * FROM chatgpt_profiles')).toBeUndefined()
    store.save('oaiapp_one', identity, { ...tokens, refreshToken: null, expiresAt: now - 1 })
    expect(store.profiles(now)[0]).toMatchObject({ connected: false, planEnabled: false })
  })
  it('removes an inactive signed-out connection without changing the active credentials', () => {
    const first = store.save('oaiapp_one', identity, tokens)
    const second = store.save('oaiapp_two', identity, tokens)
    store.clearTokens(second); store.select(first)
    store.remove(second, now)
    expect(store.profiles(now).map(profile => profile.id)).toEqual([first])
    expect(store.activeId()).toBe(first)
    expect(store.tokens(first)).toEqual(tokens)
    expect(() => store.registration(second)).toThrow('not found')
  })
  it('selects a connected remaining account when the active account is removed', () => {
    const signedOut = store.save('oaiapp_one', identity, tokens)
    store.clearTokens(signedOut)
    const connected = store.save('oaiapp_two', identity, tokens)
    const removed = store.save('oaiapp_three', identity, tokens)
    store.remove(removed, now)
    expect(store.activeId()).toBe(connected)
    expect(store.tokens(connected)).toEqual(tokens)
    expect(store.profiles(now)).toHaveLength(2)
  })
  it('clears the selection when removing the last account and rejects unknown accounts', () => {
    const id = store.save('oaiapp_one', identity, tokens)
    store.remove(id, now)
    expect(store.profiles(now)).toEqual([])
    expect(store.activeId()).toBeNull()
    expect(queryOne("SELECT value FROM settings WHERE key='chatgpt-active-profile'")).toBeUndefined()
    expect(() => store.remove(id, now)).toThrow('not found')
  })
})
