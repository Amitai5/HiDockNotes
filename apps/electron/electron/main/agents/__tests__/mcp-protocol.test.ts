import { describe, expect, it, vi } from 'vitest'
import { McpLineReader, ReadOnlyMcpServer } from '../mcp-protocol'
import product from '../../../../product.json'

async function initialize(server: ReadOnlyMcpServer, protocolVersion = '2025-11-25') {
  const value = await server.receive({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'Test client', version: '1.0' } } })
  await server.receive({ jsonrpc: '2.0', method: 'notifications/initialized' })
  return value
}
describe('read-only MCP protocol', () => {
  it.each(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'])('negotiates supported protocol %s and declares only tool access', async version => {
    const server = new ReadOnlyMcpServer(vi.fn())
    expect(await initialize(server, version)).toMatchObject({ id: 1, result: { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: product.name, version: product.version } } })
    const list = await server.receive({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(list).toMatchObject({ result: { tools: expect.arrayContaining([expect.objectContaining({ name: 'search_recordings', annotations: expect.objectContaining({ readOnlyHint: true, destructiveHint: false }) })]) } })
  })
  it('offers a supported version if the client requests a newer one', async () => {
    expect(await initialize(new ReadOnlyMcpServer(vi.fn()), '2099-01-01')).toMatchObject({ result: { protocolVersion: '2025-11-25' } })
  })
  it('requires initialization and acknowledgement before tools are called', async () => {
    const call = vi.fn(), server = new ReadOnlyMcpServer(call)
    expect(await server.receive({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toMatchObject({ error: { code: -32000 } })
    expect(await server.receive({ jsonrpc: '2.0', id: 2, method: 'ping' })).toMatchObject({ result: {} })
    expect(call).not.toHaveBeenCalled()
  })
  it('returns JSON text for a successful read and a sanitized tool error for failure', async () => {
    const call = vi.fn().mockResolvedValueOnce({ recordings: [] }).mockRejectedValueOnce(new Error('private token must never be exposed')), server = new ReadOnlyMcpServer(call)
    await initialize(server)
    const request = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_recordings', arguments: {} } }
    expect(await server.receive(request)).toMatchObject({ id: 2, result: { content: [{ type: 'text', text: '{"recordings":[]}' }], structuredContent: { recordings: [] } } })
    const failure = await server.receive({ ...request, id: 3 })
    expect(failure).toMatchObject({ result: { isError: true } })
    expect(JSON.stringify(failure)).not.toContain('private token')
  })
  it('rejects unknown methods, unavailable writes, arrays, and invalid request IDs', async () => {
    const call = vi.fn(), server = new ReadOnlyMcpServer(call)
    await initialize(server)
    expect(await server.receive({ jsonrpc: '2.0', id: 2, method: 'delete' })).toMatchObject({ error: { code: -32601 } })
    expect(await server.receive({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'delete_recording' } })).toMatchObject({ error: { code: -32602 } })
    expect(await server.receive([])).toMatchObject({ id: null, error: { code: -32600 } })
    expect(await server.receive({ jsonrpc: '2.0', id: null, method: 'tools/list' })).toMatchObject({ error: { code: -32600 } })
    expect(call).not.toHaveBeenCalled()
  })
  it('cancels an active read and sends no response to notifications', async () => {
    let signal: AbortSignal | undefined, finish: ((value: unknown) => void) | undefined
    const server = new ReadOnlyMcpServer((_name, _arguments, value) => { signal = value; return new Promise(resolve => { finish = resolve }) })
    await initialize(server)
    const call = server.receive({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_projects' } })
    expect(await server.receive({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 2 } })).toBeNull()
    expect(signal?.aborted).toBe(true)
    finish?.({})
    expect(await call).toBeNull()
    expect(await server.receive({ jsonrpc: '2.0', method: 'notifications/unknown' })).toBeNull()
  })
})
describe('bounded MCP stdio framing', () => {
  it('handles multiple lines and split UTF-8 without changing source text', () => {
    const lines: string[] = [], reader = new McpLineReader(value => lines.push(value), vi.fn())
    const bytes = Buffer.from('{"text":"Dána"}\n{"id":2}\r\n')
    reader.feed(bytes.subarray(0, 11)); reader.feed(bytes.subarray(11))
    expect(lines.map(value => JSON.parse(value))).toEqual([{ text: 'Dána' }, { id: 2 }])
  })
  it('discards an oversized incomplete line and recovers at the next newline', () => {
    const lines: string[] = [], oversized = vi.fn(), reader = new McpLineReader(value => lines.push(value), oversized, 10)
    reader.feed(Buffer.from('abcdefghijkl')); reader.feed(Buffer.from('more input\n{}\n'))
    expect(oversized).toHaveBeenCalledOnce()
    expect(lines).toEqual(['{}'])
  })
})
