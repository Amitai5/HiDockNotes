import { EventEmitter } from 'node:events'
import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatGPTAuth } from '../ai/chatgpt-auth'
import { ChatGPTStore } from '../ai/chatgpt-store'
import { CHATGPT_DISCOVERY, CHATGPT_ISSUER, CHATGPT_RESOURCE, CHATGPT_TOKEN_ENDPOINT } from '../ai/chatgpt-protocol'
import { closeDatabase, initializeDatabase } from '../services/database'

const mocked = vi.hoisted(() => ({ createServer: vi.fn() }))
vi.mock('node:http', () => ({ createServer: mocked.createServer }))
class CallbackServer extends EventEmitter {
  closed = false
  listen(_port: number, _host: string, callback: () => void): void { callback() }
  address(): { port: number } { return { port: 1455 } }
  close(): void { this.closed = true }
}
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] }
const encryption = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(Array.from(Buffer.from(value)).map(byte => byte ^ 0xa5)), decrypt: (value: Buffer) => Buffer.from(Array.from(value).map(byte => byte ^ 0xa5)).toString() }

describe('browser subscription session lifecycle', () => {
  let clock: number, store: ChatGPTStore, auth: ChatGPTAuth, server: CallbackServer, opened: URL
  let scope: string, subject: string, failure: string | null, rotatedRefresh: string | null
  let request: ReturnType<typeof vi.fn>
  const changed = vi.fn(), signedIn = vi.fn(), sessionEnded = vi.fn()
  function identity(clientId: string, nonce: string | null): string {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ iss: CHATGPT_ISSUER, aud: clientId, sub: subject, email: 'user@example.com', exp: clock / 1000 + 3600, ...(nonce ? { nonce } : {}) })).toString('base64url')
    return head + '.' + body + '.' + sign('RSA-SHA256', Buffer.from(head + '.' + body), privateKey).toString('base64url')
  }
  beforeEach(() => {
    initializeDatabase(':memory:'); clock = Date.parse('2026-10-08T10:00:00Z'); store = new ChatGPTStore(encryption)
    mocked.createServer.mockReset().mockImplementation(() => { server = new CallbackServer(); return server })
    scope = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'; subject = 'user-one'; failure = null; rotatedRefresh = null
    changed.mockReset(); signedIn.mockReset(); sessionEnded.mockReset()
    request = vi.fn(async (url: string, options: RequestInit = {}) => {
      expect(url).not.toContain('access-secret'); expect(url).not.toContain('refresh-secret')
      if (url === CHATGPT_TOKEN_ENDPOINT) {
        if (failure) return Response.json({ error: failure, error_description: 'untrusted diagnostic with secret' }, { status: 400 })
        const fields = options.body as URLSearchParams
        expect(fields.get('resource')).toBe(CHATGPT_RESOURCE)
        if (fields.get('grant_type') === 'authorization_code') { expect(fields.get('code_verifier')).toBeTruthy(); expect(fields.get('redirect_uri')).toBe(opened.searchParams.get('redirect_uri')); expect(fields.get('client_id')).not.toBe('dynamic_agent_client') }
        else { expect(fields.get('grant_type')).toBe('refresh_token'); expect(fields.has('scope')).toBe(false) }
        return Response.json({ access_token: 'access-secret-' + clock, refresh_token: rotatedRefresh ?? 'refresh-secret', id_token: identity(fields.get('client_id')!, fields.get('grant_type') === 'authorization_code' ? opened.searchParams.get('nonce') : null), token_type: 'Bearer', expires_in: 3600, scope })
      }
      if (url === CHATGPT_DISCOVERY) return Response.json({ issuer: CHATGPT_ISSUER, jwks_uri: CHATGPT_ISSUER + '/.well-known/jwks.json', revocation_endpoint: CHATGPT_ISSUER + '/api/accounts/oauth/revoke' })
      if (url.endsWith('/jwks.json')) return Response.json(jwks)
      if (url === CHATGPT_RESOURCE + '/models') { expect((options.headers as Record<string, string>).Authorization).toContain('Bearer access-secret'); return Response.json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' }] }) }
      if (url.endsWith('/oauth/revoke')) return new Response(null, { status: 200 })
      throw new Error('Unexpected endpoint')
    })
    auth = new ChatGPTAuth({ store, appName: 'HiDockNotes', openBrowser: async url => { opened = new URL(url) }, changed, signedIn, sessionEnded, request: request as typeof fetch, now: () => clock })
  })
  afterEach(() => { auth.close(); closeDatabase() })
  async function callback(fields: Record<string, string> = {}): Promise<number> {
    const params = new URLSearchParams({ state: opened.searchParams.get('state')!, code: 'authorization-code', client_id: opened.searchParams.get('client_id') === 'dynamic_agent_client' ? 'oaiapp_one' : opened.searchParams.get('client_id')!, ...fields })
    let status = 0
    let finish: () => void = () => undefined
    const done = new Promise<void>(resolve => { finish = resolve })
    server.emit('request', { method: 'GET', url: '/auth/callback?' + params, headers: { host: '127.0.0.1:1455' } }, { setHeader: vi.fn(), writeHead: (value: number) => { status = value }, end: finish })
    await done; await Promise.resolve(); await Promise.resolve()
    return status
  }
  async function connect(): Promise<string> { await auth.startSignIn(); expect(await callback()).toBe(200); return auth.state().activeProfileId! }
  function callbackUrl(fields: Record<string, string> = {}): string {
    const value = new URL(opened.searchParams.get('redirect_uri')!)
    value.search = new URLSearchParams({ state: opened.searchParams.get('state')!, code: 'authorization-code', client_id: 'oaiapp_one', ...fields }).toString()
    return value.toString()
  }
  it('completes a pasted remote callback using the original PKCE verifier and saves only encrypted credentials', async () => {
    await auth.startSignIn()
    await auth.completeCallback('  ' + callbackUrl() + '  ')
    expect(auth.state()).toMatchObject({ connected: true, planEnabled: true, signingIn: false })
    expect(JSON.stringify(auth.state())).not.toContain('secret')
    expect(server.closed).toBe(true)
    expect(signedIn).toHaveBeenCalledTimes(1)
  })
  it('requires a pending attempt before accepting a pasted callback', async () => {
    await expect(auth.completeCallback('http://127.0.0.1:1455/auth/callback?code=example')).rejects.toThrow('Start a new ChatGPT sign-in')
    expect(request).not.toHaveBeenCalled()
  })
  it.each([undefined, '', '/auth/callback?code=example', 'http://untrusted.test:1455/auth/callback', 'http://localhost:1455/auth/callback', 'https://127.0.0.1:1455/auth/callback', 'http://127.0.0.1:1456/auth/callback', 'http://127.0.0.1:1455/another', 'http://user:pass@127.0.0.1:1455/auth/callback', 'http://127.0.0.1:1455/auth/callback#secret', 'x'.repeat(20001)])('rejects pasted values outside the pending loopback callback: %#', async value => {
    await auth.startSignIn()
    await expect(auth.completeCallback(value)).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
    expect(auth.state().signingIn).toBe(true)
  })
  it('preserves the pending attempt after a pasted wrong state and accepts the matching callback', async () => {
    await auth.startSignIn()
    await expect(auth.completeCallback(callbackUrl({ state: 'wrong' }))).rejects.toThrow('did not match')
    expect(auth.state().signingIn).toBe(true); expect(request).not.toHaveBeenCalled()
    await auth.completeCallback(callbackUrl())
    expect(auth.state().connected).toBe(true)
  })
  it('handles declined consent in a pasted callback without exchanging a code', async () => {
    await auth.startSignIn()
    await expect(auth.completeCallback(callbackUrl({ error: 'access_denied' }))).rejects.toThrow('not authorized')
    expect(request).not.toHaveBeenCalled(); expect(auth.state().signingIn).toBe(false)
  })
  it('exchanges the callback only once when pasted submission and the listener overlap', async () => {
    await auth.startSignIn()
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve }), original = request.getMockImplementation()!
    request.mockImplementation(async (url, options) => { if (url === CHATGPT_TOKEN_ENDPOINT) await gate; return original(url, options) })
    const completing = auth.completeCallback(callbackUrl())
    await expect(auth.completeCallback(callbackUrl())).rejects.toThrow('already been handled')
    expect(await callback()).toBe(409)
    release(); await completing
    expect(request.mock.calls.filter(([url]) => url === CHATGPT_TOKEN_ENDPOINT)).toHaveLength(1)
    await expect(auth.completeCallback(callbackUrl())).rejects.toThrow('Start a new ChatGPT sign-in')
  })
  it('connects only after valid browser authorization and returns no tokens to UI state', async () => {
    await auth.startSignIn()
    expect(auth.state().signingIn).toBe(true)
    expect(await callback()).toBe(200)
    expect(auth.state()).toMatchObject({ connected: true, planEnabled: true, signingIn: false, welcomePending: true })
    expect(JSON.stringify(auth.state())).not.toContain('secret')
    expect(signedIn).toHaveBeenCalledWith([{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', transcription: false, chat: true }])
    expect(server.closed).toBe(true)
  })
  it('rejects an unrelated callback without exchanging a code or cancelling the real login', async () => {
    await auth.startSignIn()
    expect(await callback({ state: 'wrong' })).toBe(400)
    expect(request).not.toHaveBeenCalled()
    expect(auth.state().signingIn).toBe(true)
    auth.cancelSignIn()
    expect(server.closed).toBe(true)
    expect(auth.state().profiles).toEqual([])
  })
  it('allows only one pending browser session even when IPC sign-in calls overlap', async () => {
    const attempts = await Promise.allSettled([auth.startSignIn(), auth.startSignIn()])
    expect(attempts.map(value => value.status)).toEqual(['fulfilled', 'rejected'])
    expect(mocked.createServer).toHaveBeenCalledTimes(1)
    expect(auth.state().signingIn).toBe(true)
  })
  it('keeps identity-only connections without invoking models or enabling inference', async () => {
    scope = 'openid profile email'
    const id = await connect()
    expect(auth.state()).toMatchObject({ connected: true, planEnabled: false })
    expect(request.mock.calls.some(([url]) => String(url).endsWith('/models'))).toBe(false)
    expect(signedIn).not.toHaveBeenCalled()
    await expect(auth.accessToken(id)).rejects.toThrow('permission is not enabled')
    await auth.startSignIn(id)
    expect(opened.searchParams.get('prompt')).toBe('consent')
  })
  it('serializes refreshes and atomically replaces rotating credentials', async () => {
    const id = await connect()
    clock += 3600000; rotatedRefresh = 'replacement-refresh-secret'; request.mockClear()
    const values = await Promise.all([auth.accessToken(id), auth.accessToken(id), auth.accessToken(id)])
    expect(new Set(values).size).toBe(1)
    expect(request.mock.calls.filter(([url]) => url === CHATGPT_TOKEN_ENDPOINT)).toHaveLength(1)
    expect(store.tokens(id)?.refreshToken).toBe('replacement-refresh-secret')
    expect(store.tokens(id)?.expiresAt).toBe(clock + 3600000)
  })
  it('clears terminally invalid sessions while retaining their registration for reconnect', async () => {
    const id = await connect()
    clock += 3600000; failure = 'refresh_token_reused'
    await expect(auth.accessToken(id)).rejects.toThrow('session expired')
    expect(store.tokens(id)).toBeNull()
    expect(store.registration(id).clientId).toBe('oaiapp_one')
    expect(auth.state().connected).toBe(false)
  })
  it('preserves credentials on temporary refresh outages', async () => {
    const id = await connect()
    clock += 3600000
    request.mockImplementationOnce(async () => new Response(null, { status: 503 }))
    await expect(auth.accessToken(id)).rejects.toThrow('could not complete')
    expect(store.tokens(id)?.refreshToken).toBe('refresh-secret')
  })
  it('rejects returning authorization for another identity without replacing the active connection', async () => {
    const id = await connect(), previous = store.tokens(id)
    await auth.startSignIn(id)
    expect(opened.searchParams.get('client_id')).toBe('oaiapp_one')
    expect(opened.searchParams.has('agent_name_hint')).toBe(false)
    subject = 'different-user'
    expect(await callback()).toBe(400)
    expect(store.tokens(id)).toEqual(previous)
    expect(auth.state().activeProfileId).toBe(id)
  })
  it('revokes the renewable session and clears local tokens without deleting the client mapping', async () => {
    const id = await connect()
    expect(await auth.signOut(id)).toBeNull()
    const call = request.mock.calls.find(([url]) => String(url).endsWith('/oauth/revoke'))!
    expect(Object.fromEntries((call[1] as RequestInit).body as URLSearchParams)).toEqual({ token: 'refresh-secret', token_type_hint: 'refresh_token', client_id: 'oaiapp_one' })
    expect(store.tokens(id)).toBeNull()
    expect(store.registration(id).clientId).toBe('oaiapp_one')
  })
  it('reports unconfirmed remote revocation but still signs out locally', async () => {
    const id = await connect()
    const original = request.getMockImplementation()!
    request.mockImplementation(async (url, options) => String(url).endsWith('/oauth/revoke') ? new Response(null, { status: 503 }) : original(url, options))
    expect(await auth.signOut(id)).toContain('Remote revocation could not be confirmed')
    expect(store.tokens(id)).toBeNull()
    const reopened = new ChatGPTAuth({ store, appName: 'HiDockNotes', openBrowser: vi.fn(), changed, signedIn, now: () => clock })
    expect(reopened.state().error).toContain('Remote revocation could not be confirmed')
    reopened.close()
  })
  it.each(['signOut', 'remove'] as const)('cancels the active session and revokes the latest token when %s overlaps rotation', async action => {
    const id = await connect(), signal = auth.sessionSignal(id)
    clock += 3600000; rotatedRefresh = 'replacement-refresh-secret'
    const original = request.getMockImplementation()!
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    request.mockImplementation(async (url, options) => { if (url === CHATGPT_TOKEN_ENDPOINT) await gate; return original(url, options) })
    const renewing = expect(auth.accessToken(id)).rejects.toThrow('account changed')
    const signingOut = auth[action](id)
    expect(signal.aborted).toBe(true)
    expect(sessionEnded).toHaveBeenCalledWith(id)
    expect(auth.state().connected).toBe(false)
    await expect(auth.accessToken(id)).rejects.toThrow('signed out')
    release(); await renewing
    expect(await signingOut).toBeNull()
    const revoke = request.mock.calls.find(([url]) => String(url).endsWith('/oauth/revoke'))!
    expect(((revoke[1] as RequestInit).body as URLSearchParams).get('token')).toBe('replacement-refresh-secret')
    expect(store.tokens(id)).toBeNull()
  })
  it('removes a signed-out duplicate without network calls or interrupting the active account', async () => {
    const first = await connect(), firstSignal = auth.sessionSignal(first), previous = store.tokens(first)!
    const second = store.save('oaiapp_two', store.registration(first), previous)
    store.clearTokens(second); auth.select(first); request.mockClear(); sessionEnded.mockClear()
    expect(await auth.remove(second)).toBeNull()
    expect(auth.state().profiles.map(profile => profile.id)).toEqual([first])
    expect(auth.state()).toMatchObject({ activeProfileId: first, connected: true, planEnabled: true })
    expect(store.tokens(first)).toEqual(previous)
    expect(firstSignal.aborted).toBe(false)
    expect(sessionEnded).not.toHaveBeenCalledWith(first)
    expect(request).not.toHaveBeenCalled()
  })
  it('removes the active registration, cancels its requests and selects a connected replacement', async () => {
    const first = await connect()
    const second = store.save('oaiapp_two', store.registration(first), store.tokens(first)!)
    const signal = auth.sessionSignal(second)
    expect(await auth.remove(second)).toBeNull()
    expect(signal.aborted).toBe(true)
    expect(sessionEnded).toHaveBeenCalledWith(second)
    expect(auth.state()).toMatchObject({ activeProfileId: first, connected: true, planEnabled: true })
    expect(() => store.registration(second)).toThrow('not found')
    await expect(auth.accessToken(second)).rejects.toThrow('account changed')
    expect(auth.sessionSignal(first).aborted).toBe(false)
  })
  it('still removes local credentials if remote revocation is unavailable and reports the warning', async () => {
    const id = await connect(), original = request.getMockImplementation()!
    request.mockImplementation(async (url, options) => String(url).endsWith('/oauth/revoke') ? new Response(null, { status: 503 }) : original(url, options))
    expect(await auth.remove(id)).toContain('Remote revocation could not be confirmed')
    expect(auth.state()).toMatchObject({ profiles: [], activeProfileId: null, connected: false })
    expect(auth.state().error).toContain('Remote revocation could not be confirmed')
    expect(() => store.registration(id)).toThrow('not found')
  })
  it('cancels requests from the previous account and never supplies its token after switching', async () => {
    const first = await connect(), firstSignal = auth.sessionSignal(first)
    await auth.startSignIn(); expect(await callback({ client_id: 'oaiapp_two' })).toBe(200)
    const second = auth.state().activeProfileId!
    expect(firstSignal.aborted).toBe(true)
    expect(sessionEnded).toHaveBeenCalledWith(first)
    const secondSignal = auth.sessionSignal(second)
    auth.select(first)
    expect(secondSignal.aborted).toBe(true)
    await expect(auth.accessToken(second)).rejects.toThrow('account changed')
    expect(auth.sessionSignal(first).aborted).toBe(false)
  })
  it('persists a plan pause across auth instances and waits for explicit retry', async () => {
    const id = await connect()
    auth.block(id, 'ChatGPT usage limit reached. Manage usage.')
    await expect(auth.accessToken(id)).rejects.toThrow('usage limit')
    const reopened = new ChatGPTAuth({ store, appName: 'HiDockNotes', openBrowser: vi.fn(), changed, signedIn, request: request as typeof fetch, now: () => clock })
    expect(reopened.state().usageBlocked).toBe(true)
    reopened.resume()
    expect(await reopened.accessToken(id)).toContain('access-secret')
    reopened.close()
  })
})
