import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentGateway } from '../gateway'
import { request } from 'node:http'

let gateway: AgentGateway | undefined
afterEach(async () => { await gateway?.close(); gateway = undefined })
describe('local agent gateway', () => {
  it('binds only to loopback and requires authenticated JSON tool calls', async () => {
    const call = vi.fn(() => ({ recordings: [] }))
    gateway = new AgentGateway(call)
    const connection = await gateway.start()
    const url = `http://127.0.0.1:${connection.port}/tools`
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401)
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.token }
    expect((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: '{}' })).status).toBe(403)
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { ...headers, Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode) })
      req.on('error', reject); req.end('{}')
    })
    expect(invalidHost).toBe(403)
    const result = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name: 'list_recordings', arguments: {} }) })
    expect(await result.json()).toEqual({ result: { recordings: [] } })
    expect(call).toHaveBeenCalledExactlyOnceWith('list_recordings', {}, expect.any(AbortSignal))
    await gateway.close()
    await expect(fetch(url, { method: 'POST', headers, body: '{}' })).rejects.toThrow()
  })
  it('rejects other paths, methods, invalid JSON, and oversized requests without calling tools', async () => {
    const call = vi.fn()
    gateway = new AgentGateway(call)
    const { port, token } = await gateway.start()
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
    const url = `http://127.0.0.1:${port}/tools`
    expect((await fetch(url, { headers })).status).toBe(405)
    expect((await fetch(url + '?audio=1', { method: 'POST', headers, body: '{}' })).status).toBe(405)
    expect((await fetch(url, { method: 'POST', headers, body: '{' })).status).toBe(400)
    expect((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(17000) })).status).toBe(413)
    expect(call).not.toHaveBeenCalled()
  })
  it('awaits asynchronous meaning search and sanitizes failures', async () => {
    const call = vi.fn().mockResolvedValueOnce({ recordings: [{ id: 'meaning-match' }], mode: 'meaning' }).mockRejectedValueOnce(new Error('private model path'))
    gateway = new AgentGateway(call)
    const { port, token } = await gateway.start()
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body = JSON.stringify({ name: 'search_recordings', arguments: { query: 'borrowing costs', mode: 'meaning' } })
    const result = await fetch(`http://127.0.0.1:${port}/tools`, { method: 'POST', headers, body })
    expect(await result.json()).toMatchObject({ result: { recordings: [{ id: 'meaning-match' }], mode: 'meaning' } })
    const failure = await fetch(`http://127.0.0.1:${port}/tools`, { method: 'POST', headers, body })
    expect(failure.status).toBe(400)
    expect(await failure.text()).not.toContain('private model path')
  })
  it('cancels in-flight inference when access is disabled', async () => {
    let signal: AbortSignal | undefined
    gateway = new AgentGateway((_name, _value, pendingSignal) => new Promise((_resolve, reject) => {
      signal = pendingSignal
      pendingSignal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })
    }))
    const { port, token } = await gateway.start()
    const pending = fetch(`http://127.0.0.1:${port}/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ name: 'search_recordings', arguments: { query: 'costs', mode: 'meaning' } }) }).catch(() => null)
    await vi.waitFor(() => expect(signal).toBeDefined())
    await gateway.close()
    expect(await pending).toBeNull()
    expect(signal?.aborted).toBe(true)
  })
})
