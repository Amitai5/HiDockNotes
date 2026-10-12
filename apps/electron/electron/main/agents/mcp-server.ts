import type { Readable, Writable } from 'node:stream'
import { McpLineReader, ReadOnlyMcpServer } from './mcp-protocol'

export async function serveAgentMcp(call: (name: string, argumentsValue: unknown, signal: AbortSignal) => Promise<unknown>, input: Readable = process.stdin, stream: Writable = process.stdout): Promise<{ close(): Promise<void> }> {
  const server = new ReadOnlyMcpServer(call)
  const output = (value: unknown): void => {
    stream.write(JSON.stringify(value) + '\n')
    if (stream.writableLength > 1048576) input.pause()
  }
  const reader = new McpLineReader(line => {
    let value: unknown
    try { value = JSON.parse(line) }
    catch { output({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }); return }
    void server.receive(value).then(reply => { if (reply) output(reply) })
  }, () => output({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request exceeds the message limit.' } }))
  const read = (chunk: Buffer): void => reader.feed(chunk)
  const drain = (): void => { input.resume() }
  input.on('data', read)
  stream.on('drain', drain)
  return { close: async () => { server.close(); input.removeListener('data', read); stream.removeListener('drain', drain) } }
}
