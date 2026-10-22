import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { LocalAgentConnection } from './connection-store'

const MAX_BODY = 16384
export class AgentGateway {
  private server: Server | undefined
  private accepting = false
  private active = 0
  private readonly pending = new Set<AbortController>()
  private connection: LocalAgentConnection | undefined
  constructor(private readonly call: (name: string, value: unknown, signal: AbortSignal) => unknown) {}
  async start(): Promise<LocalAgentConnection> {
    if (this.server) throw new Error('Agent access is already running.')
    const token = randomBytes(32).toString('base64url')
    const server = createServer((request, response) => { void this.handle(request, response, token) })
    server.requestTimeout = 15000
    server.headersTimeout = 10000
    server.maxConnections = 32
    this.server = server
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
      })
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('No local connection address.')
      this.connection = { port: address.port, token }
      this.accepting = true
      return this.connection
    } catch (error) { this.server = undefined; server.close(); throw error }
  }
  async close(): Promise<void> {
    this.accepting = false
    for (const controller of this.pending) controller.abort()
    const server = this.server
    this.server = undefined
    this.connection = undefined
    if (!server) return
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections() })
  }
  private async handle(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const reply = (code: number, value: unknown): void => { if (!response.destroyed && !response.writableEnded) { response.statusCode = code; response.end(JSON.stringify(value)) } }
    if (!this.accepting || request.headers.host !== `127.0.0.1:${this.connection?.port}` || request.headers.origin !== undefined || request.socket.remoteAddress !== '127.0.0.1') { reply(403, { error: 'Local agent access only.' }); return }
    const provided = request.headers.authorization
    const expected = Buffer.from('Bearer ' + token)
    if (!provided || Buffer.byteLength(provided) !== expected.length || !timingSafeEqual(Buffer.from(provided), expected)) { reply(401, { error: 'Agent access is not authorized.' }); return }
    if (request.method !== 'POST' || request.url !== '/tools') { reply(405, { error: 'Only tool requests are available.' }); return }
    if (!request.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'Use JSON tool arguments.' }); return }
    if (this.active >= 8) { reply(429, { error: 'Too many agent requests. Try again.' }); return }
    this.active++
    const controller = new AbortController()
    this.pending.add(controller)
    const cancelled = (): void => controller.abort()
    response.once('close', cancelled)
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        size += bytes.length
        if (size > MAX_BODY) { reply(413, { error: 'Tool request is too large.' }); return }
        chunks.push(bytes)
      }
      let input: unknown
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { reply(400, { error: 'Invalid JSON tool request.' }); return }
      if (!input || typeof input !== 'object' || Array.isArray(input) || typeof (input as { name?: unknown }).name !== 'string' || Object.keys(input).some(key => !['name', 'arguments'].includes(key))) { reply(400, { error: 'Invalid tool request.' }); return }
      if (!this.accepting) { reply(403, { error: 'Agent access is off.' }); return }
      const value = input as { name: string; arguments?: unknown }
      try {
        const result = await this.call(value.name, value.arguments, controller.signal)
        if (!this.accepting || this.connection?.token !== token) reply(403, { error: 'Agent access is off.' })
        else if (!controller.signal.aborted) reply(200, { result })
      }
      catch { reply(400, { error: 'The tool or its arguments are invalid, or the recording is unavailable.' }) }
    } catch { reply(400, { error: 'The agent request could not be read.' }) }
    finally { response.removeListener('close', cancelled); this.pending.delete(controller); this.active-- }
  }
}
