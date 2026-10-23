import type { FastifyInstance } from 'fastify'

/** Relay the existing state/PKCE-validated loopback callback through the app's published port. */
export function registerChatGPTCallback(app: FastifyInstance, isPending: () => boolean, request: typeof fetch = fetch): void {
  app.get('/auth/callback', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (incoming, reply) => {
    reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
      .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
    if (incoming.method !== 'GET') return reply.code(405).header('Allow', 'GET').send()
    if (incoming.url.length > 20000 || !/^\/auth\/callback(?:\?|$)/.test(incoming.url)) return reply.code(400).type('text/plain').send('Invalid callback.')
    if (!isPending()) return reply.code(404).type('text/plain').send('Start ChatGPT sign-in in Settings first.')
    try {
      // The destination and Host stay on loopback; no browser cookies or authorization are forwarded.
      const response = await request('http://127.0.0.1:1455' + incoming.url, { redirect: 'error', signal: AbortSignal.timeout(90000) })
      if (response.status !== 200 && response.status !== 400) { await response.body?.cancel(); throw new Error('Unexpected callback response.') }
      return reply.code(response.status).type('text/html').send(await response.text())
    } catch {
      return reply.code(502).type('text/plain').send('ChatGPT sign-in could not finish. Start a new sign-in in Settings.')
    }
  })
}
