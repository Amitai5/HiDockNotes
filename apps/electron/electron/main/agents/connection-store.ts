import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SecretEncryption } from '../ai/credentials'

export interface LocalAgentConnection { port: number; token: string }
export interface ConnectionFile {
  read(): Promise<Buffer>
  write(value: Buffer): Promise<void>
  remove(): Promise<void>
}
export function connectionFile(path: string): ConnectionFile {
  return {
    read: () => readFile(path),
    write: async value => {
      await mkdir(dirname(path), { recursive: true })
      const temporary = path + '.' + randomUUID() + '.partial'
      try { await writeFile(temporary, value, { mode: 0o600, flag: 'wx' }); await rename(temporary, path) }
      finally { await rm(temporary, { force: true }) }
    },
    remove: () => rm(path, { force: true })
  }
}
export class AgentConnectionStore {
  constructor(private readonly file: ConnectionFile, private readonly encryption: SecretEncryption) {}
  async save(value: LocalAgentConnection): Promise<void> { this.requireEncryption(); await this.file.write(this.encryption.encrypt(JSON.stringify(value))) }
  async read(): Promise<LocalAgentConnection> {
    this.requireEncryption()
    try {
      const value = JSON.parse(this.encryption.decrypt(await this.file.read())) as Partial<LocalAgentConnection>
      if (!Number.isSafeInteger(value.port) || (value.port ?? 0) < 1 || (value.port ?? 0) > 65535 || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error('Invalid connection.')
      return value as LocalAgentConnection
    } catch { throw new Error('Enable MCP access in HiDockNotes Settings and keep the app running.') }
  }
  async remove(): Promise<void> { await this.file.remove() }
  private requireEncryption(): void { if (!this.encryption.isAvailable()) throw new Error('Secure operating-system storage is unavailable. Unlock your keychain to enable agent access.') }
}
