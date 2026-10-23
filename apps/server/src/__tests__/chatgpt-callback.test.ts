import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerChatGPTCallback } from '../chatgpt-callback'

let app: ReturnType<typeof Fastify>, pending: boolean
const request = vi.fn<typeof fetch>()
beforeEach(() => {
  app = Fastify(); pending = true; request.mockReset()
  registerChatGPTCallback(app, () => pending, request)
})
afterEach(async () => { await app.close() })

describe('single-port ChatGPT callback', () => {
  it('does not contact a loopback listener without a pending sign-in', async () => {
    pending = false
    const result = await app.inject('/auth/callback?code=unused&state=unused')
    expect(result.statusCode).toBe(404); expect(request).not.toHaveBeenCalled()
  })

  it('relays only to the fixed loopback destination without browser credentials', async () => {
    request.mockResolvedValue(new Response('<h1>Connected</h1>', { status: 200 }))
    const query = '?code=example%2Bcode&state=example-state&next=https%3A%2F%2Funtrusted.test'
    const result = await app.inject({ url: '/auth/callback' + query, headers: { host: 'notes.example.com', cookie: 'private-session', authorization: 'Bearer private-token', 'x-forwarded-host': 'untrusted.test' } })
    expect(result.statusCode).toBe(200); expect(result.body).toBe('<h1>Connected</h1>')
    expect(request).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:1455/auth/callback' + query, { redirect: 'error', signal: expect.any(AbortSignal) })
    expect(result.headers['cache-control']).toBe('no-store'); expect(result.headers['referrer-policy']).toBe('no-referrer')
    expect(result.headers['content-security-policy']).toContain("frame-ancestors 'none'")
    expect(result.headers['content-type']).toContain('text/html')
  })

  it('preserves the existing listener rejection for invalid OAuth state', async () => {
    request.mockResolvedValue(new Response('<h1>Invalid sign-in state</h1>', { status: 400 }))
    const result = await app.inject('/auth/callback?code=example&state=wrong')
    expect(result.statusCode).toBe(400); expect(result.body).toContain('Invalid sign-in state')
  })

  it.each([302, 404, 500])('rejects unexpected callback responses: %s', async status => {
    request.mockResolvedValue(new Response('private upstream detail', { status, headers: { location: 'https://untrusted.test' } }))
    const result = await app.inject('/auth/callback?code=example&state=example')
    expect(result.statusCode).toBe(502); expect(result.body).not.toContain('private upstream detail')
    expect(result.headers.location).toBeUndefined()
  })

  it('handles a listener that closes during sign-in without exposing callback secrets', async () => {
    request.mockRejectedValue(new Error('fetch failed with code=private-code'))
    const result = await app.inject('/auth/callback?code=private-code&state=example')
    expect(result.statusCode).toBe(502); expect(result.body).not.toContain('private-code')
  })

  it('rejects oversized callbacks before forwarding', async () => {
    const result = await app.inject('/auth/callback?code=' + 'x'.repeat(20000))
    expect(result.statusCode).toBe(400); expect(request).not.toHaveBeenCalled()
  })

  it('does not relay other paths or methods', async () => {
    expect((await app.inject('/another/callback?code=example')).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/auth/callback', payload: {} })).statusCode).toBe(404)
    expect((await app.inject({ method: 'HEAD', url: '/auth/callback?code=example' })).statusCode).toBe(405)
    expect(request).not.toHaveBeenCalled()
  })
})
