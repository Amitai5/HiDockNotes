import type { FastifyInstance, FastifyRequest } from 'fastify'
import { queryOne, run, runInTransaction } from '@hidock/core/services/database'
import { digest, passwordHash, passwordMatches, secret } from './security'
export interface AuthOptions { origin: string; setupToken: string; secure: boolean; now?: () => number }
export async function registerAuth(app: FastifyInstance, options: AuthOptions): Promise<void> {
  const now = options.now ?? Date.now, cookieName = 'hidock_session'
  const owner = () => queryOne<{ username: string; password_hash: string }>('SELECT * FROM server_owner WHERE id=1')
  const session = (request: FastifyRequest) => { const token = request.cookies[cookieName]; return token ? queryOne<{ csrf: string; expires_at: number }>('SELECT * FROM server_sessions WHERE token_hash=? AND expires_at>?', [digest(token), now()]) : undefined }
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Permissions-Policy', 'usb=(self), microphone=(self)').header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
    if (!request.url.startsWith('/api/')) return
    reply.header('Cache-Control', 'no-store')
    const isPublic = ['/api/v1/auth/session', '/api/v1/auth/setup', '/api/v1/auth/login'].includes(request.url.split('?')[0])
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.url !== '/api/v1/mcp' && request.headers.origin !== options.origin) return reply.code(403).send({ error: 'Open this app at its configured public URL.' })
    if (isPublic) return
    if (request.url === '/api/v1/mcp' && request.headers.authorization?.startsWith('Bearer ')) {
      if (!queryOne('SELECT token_hash FROM server_tokens WHERE token_hash=?', [digest(request.headers.authorization.slice(7))])) return reply.code(401).send({ error: 'Invalid MCP token.' })
      return
    }
    const current = session(request)
    if (!current) return reply.code(401).send({ error: 'Sign in to continue.' })
    if (!['GET', 'HEAD'].includes(request.method) && request.headers['x-csrf-token'] !== current.csrf) return reply.code(403).send({ error: 'Refresh the page before trying again.' })
  })
  const issue = (reply: import('fastify').FastifyReply) => { const token = secret(), csrf = secret(); run('DELETE FROM server_sessions WHERE expires_at<=?', [now()]); run('INSERT INTO server_sessions VALUES (?,?,?)', [digest(token), csrf, now() + 7 * 86400000]); reply.setCookie(cookieName, token, { path: '/', httpOnly: true, secure: options.secure, sameSite: 'strict', maxAge: 7 * 86400 }); return { authenticated: true, username: owner()!.username, csrf } }
  app.get('/api/v1/auth/session', async request => { const current = session(request); return { setupRequired: !owner(), authenticated: !!current, username: current ? owner()?.username : undefined, csrf: current?.csrf } })
  app.post<{ Body: { token: string; username: string; password: string } }>('/api/v1/auth/setup', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const value = request.body
    if (owner()) return reply.code(409).send({ error: 'The owner is already configured.' })
    if (typeof value?.token !== 'string' || digest(value.token.trim().toUpperCase()) !== digest(options.setupToken)) return reply.code(403).send({ error: 'Enter the eight-character setup code from the container logs.' })
    if (typeof value.username !== 'string' || !/^[\w.@ -]{1,80}$/.test(value.username) || typeof value.password !== 'string') return reply.code(400).send({ error: 'Choose a username and password.' })
    const hash = await passwordHash(value.password)
    runInTransaction(() => { if (owner()) throw new Error('The owner is already configured.'); run('INSERT INTO server_owner VALUES (1,?,?)', [value.username, hash]) })
    return issue(reply)
  })
  app.post<{ Body: { username: string; password: string } }>('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => { const saved = owner(), value = request.body; if (!saved || typeof value?.password !== 'string' || value.username !== saved.username || !await passwordMatches(value.password, saved.password_hash)) return reply.code(401).send({ error: 'Incorrect username or password.' }); return issue(reply) })
  app.post('/api/v1/auth/logout', async (request, reply) => { run('DELETE FROM server_sessions WHERE token_hash=?', [digest(request.cookies[cookieName] ?? '')]); reply.clearCookie(cookieName, { path: '/' }); return { ok: true } })
}
