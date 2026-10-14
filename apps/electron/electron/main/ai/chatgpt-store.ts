import { randomUUID } from 'node:crypto'
import { DEFAULT_CHATGPT_MODELS, type ChatGPTProfileView, type ModelChoice } from '../../../src/shared/ai'
import type { SecretEncryption } from './credentials'
import { queryAll, queryOne, run, runInTransaction } from '../services/database'
import { planAllowed, type ChatGPTIdentity, type ChatGPTTokens } from './chatgpt-protocol'
import { ProcessingError } from './errors'

export interface ChatGPTRegistration extends ChatGPTIdentity { id: string; clientId: string }
interface ProfileRow { id: string; label: string; client_id: string; issuer: string; subject: string; email: string | null; name: string | null; ciphertext: Buffer | null; models: string; welcome_seen: number }

export class ChatGPTStore {
  constructor(private readonly encryption: SecretEncryption) {}
  hostId(): string {
    this.requireEncryption()
    const saved = queryOne<{ value: string }>("SELECT value FROM settings WHERE key='chatgpt-host-id'")
    if (saved && /^urn:uuid:[a-f0-9-]{36}$/.test(saved.value)) return saved.value
    const value = 'urn:uuid:' + randomUUID()
    run("INSERT OR REPLACE INTO settings(key,value) VALUES ('chatgpt-host-id',?)", [value])
    return value
  }
  activeId(): string | null { return queryOne<{ value: string }>("SELECT value FROM settings WHERE key='chatgpt-active-profile'")?.value ?? null }
  select(id: string): void {
    if (!this.row(id)) throw new ProcessingError('Choose an existing ChatGPT account.')
    run("INSERT OR REPLACE INTO settings(key,value) VALUES ('chatgpt-active-profile',?)", [id])
  }
  remove(id: string, now = Date.now()): void {
    if (!this.row(id)) throw new ProcessingError('This ChatGPT account was not found.')
    runInTransaction(() => {
      run('DELETE FROM chatgpt_profiles WHERE id=?', [id])
      if (this.activeId() !== id) return
      const remaining = this.profiles(now)
      const replacement = remaining.find(profile => profile.planEnabled) ?? remaining.find(profile => profile.connected) ?? remaining[0]
      if (replacement) this.select(replacement.id)
      else run("DELETE FROM settings WHERE key='chatgpt-active-profile'")
    })
  }
  registration(id: string): ChatGPTRegistration {
    const row = this.row(id)
    if (!row) throw new ProcessingError('This ChatGPT account was not found. Add an account in Settings.')
    return { id: row.id, clientId: row.client_id, issuer: row.issuer, subject: row.subject, email: row.email, name: row.name }
  }
  save(clientId: string, identity: ChatGPTIdentity, tokens: ChatGPTTokens, models: ModelChoice[] = []): string {
    this.requireEncryption()
    const previous = queryOne<ProfileRow>('SELECT * FROM chatgpt_profiles WHERE client_id=?', [clientId])
    if (previous && (previous.issuer !== identity.issuer || previous.subject !== identity.subject)) throw new ProcessingError('ChatGPT returned a different account. Add it as a separate connection.')
    const id = previous?.id ?? randomUUID()
    const count = queryOne<{ count: number }>('SELECT count(*) AS count FROM chatgpt_profiles')?.count ?? 0
    const ciphertext = this.encryption.encrypt(JSON.stringify(tokens))
    runInTransaction(() => {
      run('INSERT INTO chatgpt_profiles(id,label,client_id,issuer,subject,email,name,ciphertext,models,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET email=excluded.email, name=excluded.name, ciphertext=excluded.ciphertext, models=excluded.models, blocked_reason=NULL, logout_warning=NULL', [id, previous?.label ?? `Connection ${count + 1}`, clientId, identity.issuer, identity.subject, identity.email, identity.name, ciphertext, JSON.stringify(models), new Date().toISOString()])
      this.select(id)
    })
    return id
  }
  tokens(id: string): ChatGPTTokens | null {
    const row = this.row(id)
    if (!row?.ciphertext) return null
    this.requireEncryption()
    try {
      const item = JSON.parse(this.encryption.decrypt(row.ciphertext)) as ChatGPTTokens
      if (!item || typeof item.accessToken !== 'string' || typeof item.idToken !== 'string' || typeof item.expiresAt !== 'number' || !Number.isFinite(item.expiresAt) || !Array.isArray(item.scopes) || !item.scopes.every(scope => typeof scope === 'string') || (item.refreshToken !== null && typeof item.refreshToken !== 'string')) throw new Error('Invalid tokens')
      return item
    } catch { throw new ProcessingError('The encrypted ChatGPT connection could not be unlocked. Sign in again in Settings.') }
  }
  replaceTokens(id: string, tokens: ChatGPTTokens): void {
    this.requireEncryption()
    if (!run('UPDATE chatgpt_profiles SET ciphertext=? WHERE id=? AND ciphertext IS NOT NULL', [this.encryption.encrypt(JSON.stringify(tokens)), id]).changes) throw new ProcessingError('The ChatGPT connection changed. Sign in again in Settings.')
  }
  clearTokens(id: string): void { run('UPDATE chatgpt_profiles SET ciphertext=NULL, blocked_reason=NULL WHERE id=?', [id]) }
  blockedReason(id: string): string | null { return queryOne<{ blocked_reason: string | null }>('SELECT blocked_reason FROM chatgpt_profiles WHERE id=?', [id])?.blocked_reason ?? null }
  block(id: string, reason: string): void { run('UPDATE chatgpt_profiles SET blocked_reason=? WHERE id=?', [reason, id]) }
  resume(id: string): void { run('UPDATE chatgpt_profiles SET blocked_reason=NULL WHERE id=?', [id]) }
  logoutWarning(id: string): string | null { return queryOne<{ logout_warning: string | null }>('SELECT logout_warning FROM chatgpt_profiles WHERE id=?', [id])?.logout_warning ?? null }
  saveLogoutWarning(id: string, message: string | null): void { run('UPDATE chatgpt_profiles SET logout_warning=? WHERE id=?', [message, id]) }
  saveModels(id: string, models: ModelChoice[]): void { run('UPDATE chatgpt_profiles SET models=? WHERE id=?', [JSON.stringify(models), id]) }
  profiles(now = Date.now()): ChatGPTProfileView[] {
    return queryAll<ProfileRow>('SELECT * FROM chatgpt_profiles ORDER BY created_at, id').map(row => {
      let tokens: ChatGPTTokens | null = null
      try { tokens = this.tokens(row.id) } catch { /* A locked keychain is disconnected, never plaintext fallback. */ }
      const models = JSON.parse(row.models) as ModelChoice[]
      const connected = !!tokens && (tokens.expiresAt > now || !!tokens.refreshToken)
      return { id: row.id, label: row.label, name: row.name, email: row.email, connected, planEnabled: connected && !!tokens && planAllowed(tokens), models: models.length ? models : DEFAULT_CHATGPT_MODELS, offline: !models.length }
    })
  }
  welcomePending(id: string): boolean { return this.row(id)?.welcome_seen === 0 }
  acknowledgeWelcome(id: string): void { run('UPDATE chatgpt_profiles SET welcome_seen=1 WHERE id=?', [id]) }
  private row(id: string): ProfileRow | undefined { return queryOne('SELECT * FROM chatgpt_profiles WHERE id=?', [id]) }
  private requireEncryption(): void { if (!this.encryption.isAvailable()) throw new ProcessingError('Secure operating-system storage is unavailable. Unlock your keychain before signing in.') }
}
