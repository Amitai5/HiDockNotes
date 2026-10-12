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
    expect(call).toHaveBeenCalledExactlyOnceWith('list_recordings', {})
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
})
