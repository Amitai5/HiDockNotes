import { DEFAULT_MODELS, type ModelChoice, type ProviderId, type ProviderState } from '../../../src/shared/ai'
import { queryOne, run } from '../services/database'

export interface SecretEncryption { isAvailable(): boolean; encrypt(value: string): Buffer; decrypt(value: Buffer): string }
interface CredentialRow { ciphertext: Buffer; verified_at: string; models: string }

export class CredentialVault {
  constructor(private readonly encryption: SecretEncryption) {}
  saveVerified(provider: ProviderId, key: string, models: ModelChoice[]): void {
    this.requireEncryption()
    const encrypted = this.encryption.encrypt(key)
    run('INSERT OR REPLACE INTO provider_credentials(provider, ciphertext, verified_at, models) VALUES (?, ?, ?, ?)', [provider, encrypted, new Date().toISOString(), JSON.stringify(models)])
  }
  read(provider: ProviderId): string | null {
    const row = this.row(provider)
    if (!row) return null
    this.requireEncryption()
    try { return this.encryption.decrypt(row.ciphertext) } catch { throw new Error('The encrypted API key could not be unlocked. Verify a new key in Settings.') }
  }
  remove(provider: ProviderId): void { run('DELETE FROM provider_credentials WHERE provider=?', [provider]) }
  updateModels(provider: ProviderId, models: ModelChoice[]): void { run('UPDATE provider_credentials SET models=?, verified_at=? WHERE provider=?', [JSON.stringify(models), new Date().toISOString(), provider]) }
  state(provider: ProviderId): ProviderState {
    const row = this.row(provider)
    const models = row ? JSON.parse(row.models) as ModelChoice[] : []
    return { provider, configured: !!row, verified: !!row && this.encryption.isAvailable(), verifiedAt: row?.verified_at ?? null, models: models.length ? models : DEFAULT_MODELS[provider], offline: !models.length }
  }
  private row(provider: ProviderId): CredentialRow | undefined { return queryOne('SELECT ciphertext, verified_at, models FROM provider_credentials WHERE provider=?', [provider]) }
  private requireEncryption(): void { if (!this.encryption.isAvailable()) throw new Error('Secure operating-system key storage is unavailable. Unlock your keychain and try again.') }
}
export function validateApiKey(provider: ProviderId, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length < 4 || value.length > 1000 || /\s/.test(value.trim())) throw new Error('Enter a valid API key.')
  const key = value.trim()
  if (provider === 'gemini' && !key.startsWith('AIza') && !key.startsWith('AQ')) throw new Error('A Gemini key starts with AIza or AQ. Verification checks it with Google.')
  // Prefixes are only a helpful input check. A live models call proves validity.
  return key
}
