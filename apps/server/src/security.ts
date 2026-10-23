import { createCipheriv, createDecipheriv, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SecretEncryption } from '@hidock/core/ai/credentials'
const scrypt = promisify(scryptCallback)
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
export const secret = (): string => randomBytes(32).toString('base64url')
/** First-run owner code; session tokens and encryption keys retain their full strength. */
export function setupCode(): string { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('') }
export function privateFile(file: string): Buffer {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  if (!existsSync(file)) { try { writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error } }
  const key = readFileSync(file); if (key.length !== 32) throw new Error('The server secret key must contain exactly 32 bytes.'); return key
}
export function encryption(key: Buffer): SecretEncryption {
  return { isAvailable: () => true, encrypt(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]) }, decrypt(value) { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(-16)); return Buffer.concat([cipher.update(value.subarray(12, -16)), cipher.final()]).toString('utf8') } }
}
export async function passwordHash(value: string): Promise<string> { if (value.length < 12 || value.length > 200) throw new Error('Use a password between 12 and 200 characters.'); const salt = secret(); return salt + ':' + (await scrypt(value, salt, 64) as Buffer).toString('hex') }
export async function passwordMatches(value: string, encoded: string): Promise<boolean> { if (value.length > 200) return false; const [salt, hash] = encoded.split(':'); const actual = await scrypt(value, salt, 64) as Buffer, expected = Buffer.from(hash ?? '', 'hex'); return expected.length === actual.length && timingSafeEqual(expected, actual) }
