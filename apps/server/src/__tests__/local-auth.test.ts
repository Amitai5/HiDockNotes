import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApplication } from '../application'

const publicOrigin = 'https://notes.example.com', localOrigin = 'http://truenas.local:10708'
const credentials = { username: 'owner', password: 'a-long-test-password' }
let folder: string, token: string, app: Awaited<ReturnType<typeof createApplication>>
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'hidock-local-auth-'))
  app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin: publicOrigin, additionalOrigins: [localOrigin], processing: false })
  await app.ready(); token = await readFile(join(folder, 'data', 'secrets', 'setup-code'), 'utf8')
})
afterEach(async () => { await app.close(); await rm(folder, { recursive: true, force: true }) })
const cookies = (result: { cookies: { name: string; value: string }[] }) => result.cookies.map(value => value.name + '=' + value.value).join('; ')
async function setup(origin: string) { return app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin }, payload: { ...credentials, token } }) }

describe('public and explicitly allowed local sign-in', () => {
  it.each([localOrigin, publicOrigin])('sets up an owner and keeps the session on %s', async origin => {
    const result = await setup(origin)
    expect(result.statusCode).toBe(200)
    const cookie = result.cookies[0]
    expect(cookie.name).toBe(origin === localOrigin ? 'hidock_local_session' : 'hidock_session')
    expect(cookie.secure === true).toBe(origin === publicOrigin)
    expect(cookie.httpOnly).toBe(true); expect(cookie.sameSite).toBe('Strict'); expect(cookie.domain).toBeUndefined()
    const headers = { origin, cookie: cookies(result), 'x-csrf-token': result.json().csrf }
    expect((await app.inject({ url: '/api/v1/auth/session', headers })).json().authenticated).toBe(true)
    const folder = await app.inject({ method: 'POST', url: '/api/v1/rpc/projects:create', headers, payload: { args: ['Local folder'] } })
    expect(folder.statusCode).toBe(200); expect(folder.json().result.name).toBe('Local folder')
  })

  it('signs into the same owner from both addresses without downgrading the public cookie', async () => {
    const secure = await setup(publicOrigin)
    const local = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: localOrigin, 'x-forwarded-proto': 'https' }, payload: credentials })
    expect(local.statusCode).toBe(200); expect(local.cookies[0].secure).not.toBe(true)
    expect(local.cookies[0].name).not.toBe(secure.cookies[0].name)
    const publicLogin = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin: publicOrigin, 'x-forwarded-proto': 'http' }, payload: credentials })
    expect(publicLogin.cookies[0].secure).toBe(true)
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/setup', headers: { origin: localOrigin }, payload: { ...credentials, token } })).statusCode).toBe(409)
  })

  it.each(['http://truenas.local:10709', 'http://truenas.local.evil.test:10708', 'https://other.test', 'null', undefined])('rejects unconfigured or missing browser origins: %s', async origin => {
    const login = await setup(localOrigin)
    const headers = { cookie: cookies(login), 'x-csrf-token': login.json().csrf, ...(origin ? { origin } : {}), 'x-forwarded-host': 'truenas.local:10708' }
    const result = await app.inject({ method: 'POST', url: '/api/v1/rpc/projects:create', headers, payload: { args: ['Rejected'] } })
    expect(result.statusCode).toBe(403)
    expect(result.json().error).toContain('APP_ALLOWED_ORIGINS')
  })

  it('still requires CSRF on local requests and revokes the local session on logout', async () => {
    const login = await setup(localOrigin), cookie = cookies(login), csrf = login.json().csrf
    const invalid = await app.inject({ method: 'POST', url: '/api/v1/rpc/projects:create', headers: { origin: localOrigin, cookie, 'x-csrf-token': 'wrong' }, payload: { args: ['Rejected'] } })
    expect(invalid.statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin: localOrigin, cookie, 'x-csrf-token': csrf } })).statusCode).toBe(200)
    expect((await app.inject({ url: '/api/v1/auth/session', headers: { cookie } })).json().authenticated).toBe(false)
    expect((await app.inject({ url: '/api/v1/recordings/example/audio', headers: { cookie } })).statusCode).toBe(401)
  })

  it('keeps the old HTTPS cookie valid after an application restart', async () => {
    const login = await setup(publicOrigin), cookie = cookies(login)
    await app.close()
    app = await createApplication({ dataPath: join(folder, 'data'), backupPath: join(folder, 'backups'), origin: publicOrigin, additionalOrigins: [localOrigin], processing: false })
    const session = await app.inject({ url: '/api/v1/auth/session', headers: { cookie } })
    expect(session.json()).toMatchObject({ authenticated: true, username: credentials.username, csrf: login.json().csrf })
  })
})
