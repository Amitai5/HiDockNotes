import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, initializeDatabase, queryOne } from '../services/database'
import { readAISettings, updateAISettings, validateAISettings } from '../ai/settings'
import { CredentialVault, validateApiKey } from '../ai/credentials'
import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS } from '../../../src/shared/ai'

describe('AI settings and encrypted credentials', () => {
  beforeEach(() => initializeDatabase(':memory:'))
  afterEach(closeDatabase)
  const encryption = { isAvailable: () => true, encrypt: (value: string) => Buffer.from(Array.from(Buffer.from(value)).map(byte => byte ^ 0xa5)), decrypt: (value: Buffer) => Buffer.from(Array.from(value).map(byte => byte ^ 0xa5)).toString() }
  it('keeps transcription and chat choices independent', () => {
    updateAISettings({ transcription: { provider: 'openai', model: 'whisper-1' } })
    expect(readAISettings()).toMatchObject({ transcription: { provider: 'openai', model: 'whisper-1' }, chat: DEFAULT_AI_SETTINGS.chat })
  })
  it('defaults to local Whisper and rejects using it as a chat model', () => {
    expect(readAISettings().transcription).toEqual({ provider: 'local', model: 'whisper-base' })
    expect(() => validateAISettings({ chat: { provider: 'local', model: 'whisper-small' } })).toThrow('for transcription')
    expect(() => validateAISettings({ transcription: { provider: 'local', model: 'custom-model' } })).toThrow('timestamps')
  })
  it('supports subscription chat without advertising or accepting subscription audio', () => {
    updateAISettings({ chat: { provider: 'chatgpt', model: 'gpt-6.1-sol' } })
    expect(readAISettings().transcription).toEqual(DEFAULT_AI_SETTINGS.transcription)
    expect(readAISettings().chat.provider).toBe('chatgpt')
    expect(() => validateAISettings({ transcription: { provider: 'chatgpt', model: 'gpt-6.1-sol' } })).toThrow('does not support audio')
  })
  it.each(['AQ.test-key', 'AQanother-valid-prefix', 'AIzaexample-key'])('accepts the Gemini key prefix %s without inventing additional prefix rules', key => {
    expect(validateApiKey('gemini', key)).toBe(key)
  })
  it('rejects unknown settings, invalid thresholds and models without timestamps', () => {
    expect(() => validateAISettings({ secret: 'key' })).toThrow('Unknown')
    expect(() => validateAISettings({ suggestThreshold: 0.8, autoAssignThreshold: 0.7 })).toThrow('lower')
    expect(() => validateAISettings({ transcription: { provider: 'openai', model: 'gpt-4o-mini-transcribe' } })).toThrow('timestamps')
    expect(() => validateAISettings({ autoAssignThreshold: NaN })).toThrow()
    expect(() => validateApiKey('gemini', 'sk-openai')).toThrow('AIza or AQ')
  })
  it('stores only encrypted binary credentials and never includes keys in renderer state', () => {
    const vault = new CredentialVault(encryption), key = 'AQ.secret-not-for-renderer'
    vault.saveVerified('gemini', key, DEFAULT_MODELS.gemini)
    const row = queryOne<{ ciphertext: Buffer; models: string }>('SELECT ciphertext, models FROM provider_credentials')!
    expect(Buffer.isBuffer(row.ciphertext)).toBe(true)
    expect(row.ciphertext.includes(Buffer.from(key))).toBe(false)
    expect(vault.read('gemini')).toBe(key)
    expect(JSON.stringify(vault.state('gemini'))).not.toContain(key)
    expect(queryOne("SELECT value FROM settings WHERE key='apiKey'")).toBeUndefined()
    vault.remove('gemini')
    expect(vault.read('gemini')).toBeNull()
  })
  it('refuses plaintext fallback when OS encryption is unavailable', () => {
    const vault = new CredentialVault({ ...encryption, isAvailable: () => false })
    expect(() => vault.saveVerified('openai', 'sk-fake', DEFAULT_MODELS.openai)).toThrow('key storage')
    expect(queryOne('SELECT * FROM provider_credentials')).toBeUndefined()
  })
  it('defaults old persisted settings to one job per stage and persists independent limits', () => {
    const legacy = { ...DEFAULT_AI_SETTINGS } as Record<string, unknown>
    delete legacy.maxConcurrentTranscriptions; delete legacy.maxConcurrentSummaries
    expect(validateAISettings(legacy)).toMatchObject({ maxConcurrentTranscriptions: 1, maxConcurrentSummaries: 1 })
    updateAISettings({ maxConcurrentTranscriptions: 2, maxConcurrentSummaries: 4 })
    expect(readAISettings()).toMatchObject({ maxConcurrentTranscriptions: 2, maxConcurrentSummaries: 4 })
  })
  it.each([0, -1, 1.5, NaN, Infinity, '2', null, 5])('rejects invalid transcription concurrency: %s', value => {
    expect(() => validateAISettings({ maxConcurrentTranscriptions: value })).toThrow('between 1 and 4')
  })
  it.each([0, 1.5, 9, '2', null])('rejects invalid summary concurrency: %s', value => {
    expect(() => validateAISettings({ maxConcurrentSummaries: value })).toThrow('between 1 and 8')
  })

})
