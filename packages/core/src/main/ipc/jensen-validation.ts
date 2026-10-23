// Adapted from sgeraldes/hidock-next-2 @ 31d44da (MIT).
/**
 * Zod validation schemas for Jensen IPC handlers.
 * Enforces security constraints on all user-supplied values crossing the IPC boundary.
 */
// Adaptation: equivalent explicit guards avoid adding a validation dependency.
export function validateDeviceFilename(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 255 || value.includes('..') || /[\x00-\x1f\\/:*?"<>|]/.test(value)) throw new Error('Invalid device filename.')
  return value
}
export function validateFilenames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000) throw new Error('Invalid file selection.')
  return [...new Set(value.map(validateDeviceFilename))]
}
export function validateBoolean(value: unknown): boolean { if (typeof value !== 'boolean') throw new Error('Expected a boolean.'); return value }
export function validateId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid identifier.')
  return value
}
export function validateText(value: unknown, maxLength = 200): string { if (typeof value !== 'string' || value.length > maxLength) throw new Error('Invalid text.'); return value.trim() }
