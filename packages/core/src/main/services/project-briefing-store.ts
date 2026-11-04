import { queryOne, run } from './database'
import type { BriefingDays, ProjectBriefing } from '../../../src/shared/project-briefing'

export interface StoredProjectBriefing { format: 1; fingerprint: string; document: ProjectBriefing }
const prefix = (projectId: string): string => `project-briefing:${projectId}:`

/** Reads a derived briefing; malformed caches can be replaced by generating again. */
export function readProjectBriefing(projectId: string, days: BriefingDays): StoredProjectBriefing | null {
  const value = queryOne<{ value: string }>('SELECT value FROM settings WHERE key=?', [prefix(projectId) + days])?.value
  if (!value || value.length > 160000) return null
  try {
    const saved = JSON.parse(value) as StoredProjectBriefing
    if (saved?.format !== 1 || typeof saved.fingerprint !== 'string' || !saved.document || !Array.isArray(saved.document.sources) || !saved.document.content || !Number.isFinite(Date.parse(saved.document.generatedAt)) || typeof saved.document.model !== 'string' || saved.document.model.length > 200 || typeof saved.document.provider !== 'string' || !Number.isFinite(Date.parse(saved.document.since)) || !Number.isFinite(Date.parse(saved.document.until))) return null
    if (saved.document.sources.some(source => !source || !Number.isSafeInteger(source.number) || typeof source.recordingId !== 'string' || typeof source.title !== 'string' || typeof source.excerpt !== 'string' || source.excerpt.length > 2000 || !['summary', 'transcript'].includes(source.basis) || !Number.isFinite(Date.parse(source.recordedAt)) || source.start !== null && (!Number.isFinite(source.start) || source.start < 0))) return null
    return saved
  } catch { return null }
}

/** Saves the last successful on-demand briefing in the existing server settings store. */
export function saveProjectBriefing(projectId: string, days: BriefingDays, value: StoredProjectBriefing): void {
  run('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', [prefix(projectId) + days, JSON.stringify(value)])
}

/** Removes derived meeting text when its recordings leave a project or are deleted. */
export function discardProjectBriefings(projectId: string | null): void {
  if (!projectId) return
  const key = prefix(projectId)
  run('DELETE FROM settings WHERE substr(key,1,?)=?', [key.length, key])
}
