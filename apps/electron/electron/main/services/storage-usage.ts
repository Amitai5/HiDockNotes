import { queryOne } from './database'
let cachedBytes: number | undefined
export function resetStorageLimitCache(): void { cachedBytes = undefined }
export function getRecordingsUsage(): number {
  cachedBytes ??= queryOne<{ bytes: number }>('SELECT coalesce(sum(file_size), 0) AS bytes FROM recordings WHERE file_path IS NOT NULL')?.bytes ?? 0
  return cachedBytes
}
