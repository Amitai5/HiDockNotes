import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ServerConnection } from '../../src/shared/server-connection'

/** Server mode needs HTTPS for durable browser staging; loopback HTTP is allowed for development. */
export function validateServerOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter the HTTPS address of your HiDockNotes server.')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('Enter a complete server address, including https://.') }
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTPS server address without a path, password or URL parameters. Local network HTTP cannot support USB staging.')
  return url.origin
}
export function readServerConnection(directory: string): ServerConnection {
  const file = join(directory, 'server-connection.json')
  if (!existsSync(file)) return { origin: null }
  const saved = JSON.parse(readFileSync(file, 'utf8')) as ServerConnection
  return { origin: saved.origin === null ? null : validateServerOrigin(saved.origin) }
}
/** Connection preferences are separate from local library settings and never store account credentials. */
export function saveServerConnection(directory: string, origin: string | null): void {
  const value = { origin: origin === null ? null : validateServerOrigin(origin) }
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'server-connection.json'), temporary = file + '.tmp'
  writeFileSync(temporary, JSON.stringify(value) + '\n', { mode: 0o600 })
  renameSync(temporary, file)
}
