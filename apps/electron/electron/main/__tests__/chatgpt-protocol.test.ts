import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CHATGPT_ISSUER, CHATGPT_RESOURCE, ChatGPTPlanBlocked, authorizationUrl, callbackResult, chatgptError, parseChatGPTModels, parseTokens, planAllowed, validateIdentity, type AuthorizationAttempt } from '../ai/chatgpt-protocol'

const now = Date.parse('2026-10-08T10:00:00Z')
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-signing-key', alg: 'RS256', use: 'sig' }] }
function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): string {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-signing-key', ...header })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ iss: CHATGPT_ISSUER, aud: 'oaiapp_example', sub: 'account-one', nonce: 'nonce', exp: now / 1000 + 3600, iat: now / 1000, email: 'test@example.com', ...claims })).toString('base64url')
  return head + '.' + body + '.' + sign('RSA-SHA256', Buffer.from(head + '.' + body), privateKey).toString('base64url')
}
const attempt: AuthorizationAttempt = { clientId: 'dynamic_agent_client', hostId: 'urn:uuid:host', appName: 'HiDockNotes', state: 'state-value', nonce: 'nonce', verifier: 'verifier', redirectUri: 'http://127.0.0.1:1455/auth/callback' }

describe('official ChatGPT plan OAuth contract', () => {
  it('uses dynamic registration, a stable host, all plan scopes and PKCE without a client secret', () => {
    const url = new URL(authorizationUrl(attempt))
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/api/accounts/authorize')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: 'dynamic_agent_client', agent_name_hint: 'HiDockNotes', ext_agent_host_id: attempt.hostId, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource: CHATGPT_RESOURCE, redirect_uri: attempt.redirectUri, state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(attempt.verifier).digest('base64url') })
    expect(url.searchParams.has('client_secret')).toBe(false)
  })
  it('reauthorizes the saved client without changing registration or exposing an ID token', () => {
    const url = new URL(authorizationUrl({ ...attempt, clientId: 'oaiapp_saved', identity: { issuer: CHATGPT_ISSUER, subject: 'one', email: 'test@example.com', name: null } }))
    expect(url.searchParams.get('client_id')).toBe('oaiapp_saved')
    expect(url.searchParams.has('agent_name_hint')).toBe(false)
    expect(url.searchParams.has('id_token_hint')).toBe(false)
    expect(url.searchParams.has('prompt')).toBe(false)
    expect(new URL(authorizationUrl({ ...attempt, requestConsent: true })).searchParams.get('prompt')).toBe('consent')
  })
  it('exchanges the issued callback client rather than the bootstrap client', () => {
    expect(callbackResult(new URL(attempt.redirectUri + '?code=code&state=state-value&client_id=oaiapp_issued'), attempt)).toEqual({ code: 'code', clientId: 'oaiapp_issued' })
    expect(callbackResult(new URL(attempt.redirectUri + '?code=code&state=state-value'), { ...attempt, clientId: 'oaiapp_saved' })).toEqual({ code: 'code', clientId: 'oaiapp_saved' })
  })
  it.each(['?code=code&state=wrong&client_id=oaiapp_issued', '?code=code&state=state-value', '?code=code&state=state-value&client_id=dynamic_agent_client', '?code=code&state=state-value&state=state-value&client_id=oaiapp_issued', '?error=access_denied&state=state-value'])('rejects invalid or denied callback %s', query => {
    expect(() => callbackResult(new URL(attempt.redirectUri + query), attempt)).toThrow()
  })
  it('rejects a callback that changes a returning account client ID', () => {
    expect(() => callbackResult(new URL(attempt.redirectUri + '?code=code&state=state-value&client_id=oaiapp_other'), { ...attempt, clientId: 'oaiapp_saved' })).toThrow('changed accounts')
  })
  it('validates a signed identity against the issued audience, nonce and issuer', () => {
    expect(validateIdentity(token(), jwks, 'oaiapp_example', 'nonce', now)).toMatchObject({ subject: 'account-one', issuer: CHATGPT_ISSUER, email: 'test@example.com' })
  })
  it.each([{ iss: 'https://attacker.example' }, { aud: 'another-client' }, { nonce: 'another-nonce' }, { exp: now / 1000 - 1 }, { iat: now / 1000 + 3600 }, { nbf: now / 1000 + 3600 }, { sub: '' }, { aud: ['oaiapp_example', 'other-client'], azp: 'other-client' }])('rejects signed but invalid identity claims %j', claims => {
    expect(() => validateIdentity(token(claims), jwks, 'oaiapp_example', 'nonce', now)).toThrow('could not be verified')
  })
  it('rejects unsigned algorithms, duplicate keys and altered signatures', () => {
    expect(() => validateIdentity(token({}, { alg: 'none' }), jwks, 'oaiapp_example', 'nonce', now)).toThrow()
    expect(() => validateIdentity(token(), { keys: [jwks.keys[0], jwks.keys[0]] }, 'oaiapp_example', 'nonce', now)).toThrow()
    const parts = token().split('.')
    parts[2] = Buffer.from('wrong signature').toString('base64url')
    expect(() => validateIdentity(parts.join('.'), jwks, 'oaiapp_example', 'nonce', now)).toThrow()
  })
  it('uses granted scopes, rotates refresh tokens and respects returned expiry', () => {
    const first = parseTokens({ access_token: 'access', refresh_token: 'refresh', id_token: 'identity', token_type: 'Bearer', expires_in: 3600, earliest_refresh_at: now / 1000 + 300, scope: 'openid resource.invoke chatgpt.tokens.use.direct' }, now)
    expect(first).toMatchObject({ expiresAt: now + 3600000, earliestRefreshAt: now + 300000 })
    expect(planAllowed(first)).toBe(true)
    const refreshed = parseTokens({ access_token: 'access-two', refresh_token: 'refresh-two', token_type: 'Bearer', expires_in: 3600 }, now + 1000, first)
    expect(refreshed).toMatchObject({ accessToken: 'access-two', refreshToken: 'refresh-two', idToken: 'identity', scopes: first.scopes })
    expect(planAllowed({ ...first, scopes: ['openid'] })).toBe(false)
    expect(() => parseTokens({ access_token: 'access', token_type: 'Bearer', expires_in: 3600 }, now)).toThrow('incomplete')
  })
  it('loads only visible account models in server order, with no audio capability', () => {
    expect(parseChatGPTModels({ models: [{ slug: 'gpt-6.1-sol', display_name: 'Sol', visibility: 'list' }, { slug: 'hidden', visibility: 'hidden' }, { slug: 'gpt-6-luna', display_name: 'Luna', visibility: 'list' }, { slug: 'gpt-6.1-sol', visibility: 'list' }, { slug: 'bad model', visibility: 'list' }] })).toEqual([{ id: 'gpt-6.1-sol', name: 'Sol', transcription: false, chat: true }, { id: 'gpt-6-luna', name: 'Luna', transcription: false, chat: true }])
  })
  it('distinguishes a usage block from temporary unavailability without echoing provider details', () => {
    expect(chatgptError('subscription_sharing_usage_limit_exceeded')).toBeInstanceOf(ChatGPTPlanBlocked)
    expect(chatgptError('subscription_sharing_usage_unavailable').retryable).toBe(true)
    expect(chatgptError('untrusted secret response').message).not.toContain('untrusted')
  })
})
