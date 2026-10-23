import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDatabase } from '@hidock/core/services/database'
import { CHATGPT_DISCOVERY, CHATGPT_ISSUER, CHATGPT_RESOURCE, CHATGPT_TOKEN_ENDPOINT } from '@hidock/core/ai/chatgpt-protocol'
import { createApplication } from '../application'

const origin = 'http://truenas.local:10708'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'remote-test-key', alg: 'RS256', use: 'sig' }] }
let app: Awaited<ReturnType<typeof createApplication>>, folder: string, opened: URL, headers: Record<string, string>
const request = vi.fn<typeof fetch>()
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'hidock-remote-chatgpt-'))
  const webPath = join(folder, 'web')
  await mkdir(webPath); await writeFile(join(webPath, 'index.html'), '<!doctype html><title>HiDockNotes test website</title>')
  request.mockReset().mockImplementation(async (value, options) => {
    const url = String(value)
    if (url === CHATGPT_TOKEN_ENDPOINT) {
      const fields = options!.body as URLSearchParams
      expect(fields.get('redirect_uri')).toBe(opened.searchParams.get('redirect_uri'))
      expect(fields.get('client_id')).toBe('oaiapp_remote_test')
      expect(fields.get('code')).toBe('server-test-code'); expect(fields.get('code_verifier')).toBeTruthy()
      const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'remote-test-key' })).toString('base64url')
      const body = Buffer.from(JSON.stringify({ iss: CHATGPT_ISSUER, aud: 'oaiapp_remote_test', sub: 'remote-test-user', email: 'qa@example.test', nonce: opened.searchParams.get('nonce'), exp: Date.now() / 1000 + 3600 })).toString('base64url')
      const idToken = head + '.' + body + '.' + sign('RSA-SHA256', Buffer.from(head + '.' + body), privateKey).toString('base64url')
      return Response.json({ access_token: 'remote-test-access-secret', refresh_token: 'remote-test-refresh-secret', id_token: idToken, token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' })
    }
    if (url === CHATGPT_DISCOVERY) return Response.json({ issuer: CHATGPT_ISSUER, jwks_uri: CHATGPT_ISSUER + '/test/jwks', revocation_endpoint: CHATGPT_ISSUER + '/test/revoke' })
    if (url === CHATGPT_ISSUER + '/test/jwks') return Response.json(jwks)
    if (url === CHATGPT_RESOURCE + '/models') return Response.json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'Test model', visibility: 'list' }] })
    throw new Error('Unexpected mock provider endpoint')
  })
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin, webPath, processing: false, setupLog: () => undefined, chatgpt: { request, callbackPort: 0 } })
  const token = await readFile(join(folder, 'data', 'secrets', 'setup-code'), 'utf8')
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin }, payload: { token, username: 'owner', password: 'isolated-owner-password' } })
  expect(login.statusCode).toBe(200)
  headers = { origin, cookie: login.cookies.map(cookie => cookie.name + '=' + cookie.value).join('; '), 'x-csrf-token': login.json().csrf }
  expect((await app.inject({ method: 'POST', url: '/api/v1/rpc/chatgpt:sign-in', headers, payload: { args: [null] } })).statusCode).toBe(200)
  opened = new URL((await app.inject({ url: '/api/v1/chatgpt/authorization', headers })).json().url)
})
afterEach(async () => { await app.close(); await rm(folder, { recursive: true, force: true }) })
function returned(fields: Record<string, string> = {}): string {
  const value = new URL(opened.searchParams.get('redirect_uri')!)
  value.search = new URLSearchParams({ code: 'server-test-code', client_id: 'oaiapp_remote_test', state: opened.searchParams.get('state')!, ...fields }).toString()
  return value.toString()
}
const submit = (url: unknown, requestHeaders = headers) => app.inject({ method: 'POST', url: '/api/v1/chatgpt/callback', headers: requestHeaders, payload: { url } })

describe('authenticated remote ChatGPT callback completion', () => {
  it('finishes browser sign-in over the app API without a callback request from the browser', async () => {
    const result = await submit(returned())
    expect(result.statusCode).toBe(200)
    expect(result.json().result.chatgpt).toMatchObject({ connected: true, planEnabled: true, signingIn: false })
    expect(result.json().result.settings.chat.provider).toBe('chatgpt')
    expect(result.body).not.toContain('secret'); expect(result.body).not.toContain('server-test-code')
    expect(getDatabase().serialize().includes(Buffer.from('remote-test-access-secret'))).toBe(false)
    expect(getDatabase().serialize().includes(Buffer.from('remote-test-refresh-secret'))).toBe(false)
    expect(result.headers['cache-control']).toBe('no-store')
  })
  it('requires the owner session, an allowed origin and the matching CSRF token', async () => {
    expect((await submit(returned(), { origin })).statusCode).toBe(401)
    expect((await submit(returned(), { ...headers, origin: 'https://untrusted.test' })).statusCode).toBe(403)
    expect((await submit(returned(), { ...headers, 'x-csrf-token': 'wrong' })).statusCode).toBe(403)
    expect(request).not.toHaveBeenCalled()
  })
  it('preserves the pending attempt after a wrong state and then accepts the correct callback', async () => {
    const rejected = await submit(returned({ state: 'wrong' }))
    expect(rejected.statusCode).toBe(400); expect(rejected.json().error).toContain('did not match')
    expect(request).not.toHaveBeenCalled()
    expect((await submit(returned())).statusCode).toBe(200)
  })
  it.each(['http://untrusted.test/auth/callback?code=secret', 'http://127.0.0.1:1/auth/callback', '/auth/callback', null])('rejects invalid callback addresses without making a request: %#', async value => {
    expect((await submit(value)).statusCode).toBe(400)
    expect(request).not.toHaveBeenCalled()
  })
  it('does not reuse a completed callback', async () => {
    const url = returned()
    expect((await submit(url)).statusCode).toBe(200)
    const calls = request.mock.calls.length
    expect((await submit(url)).statusCode).toBe(400)
    expect(request).toHaveBeenCalledTimes(calls)
  })
})
