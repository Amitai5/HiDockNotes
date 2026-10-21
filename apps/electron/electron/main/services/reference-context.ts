import { EMPTY_REFERENCE_CONTEXT, REFERENCE_CONTEXT_LIMITS, type ReferenceContext, type ReferenceContextDocument, type ReferenceContextSnapshot } from '../../../src/shared/reference-context'
import { queryAll, queryOne, run, runInTransaction } from './database'

function contextKey(projectId: string | null): string {
  if (projectId !== null && !queryOne('SELECT id FROM projects WHERE id=?', [projectId])) throw new Error('This project folder no longer exists.')
  return projectId === null ? 'reference-context:global' : `reference-context:project:${projectId}`
}

function validateContent(value: unknown): ReferenceContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid reference context.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).some(key => !Object.hasOwn(REFERENCE_CONTEXT_LIMITS, key))) throw new Error('Unknown reference context field.')
  const result = { ...EMPTY_REFERENCE_CONTEXT }
  for (const field of Object.keys(REFERENCE_CONTEXT_LIMITS) as (keyof ReferenceContext)[]) {
    const text = input[field]
    if (typeof text !== 'string' || text.length > REFERENCE_CONTEXT_LIMITS[field] || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error(`Invalid ${field} context. Use at most ${REFERENCE_CONTEXT_LIMITS[field]} characters.`)
    result[field] = text.replace(/\r\n?/g, '\n').trim()
  }
  return result
}

/** Reads one locally saved context without inheriting another project's details. */
export function readReferenceContext(projectId: string | null): ReferenceContextDocument {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key=?', [contextKey(projectId)])
  if (!row) return { content: { ...EMPTY_REFERENCE_CONTEXT }, version: 0, updatedAt: null }
  let value: Partial<ReferenceContextDocument>
  try { value = JSON.parse(row.value) as Partial<ReferenceContextDocument> } catch { throw new Error('The saved reference context could not be read.') }
  if (!value || typeof value !== 'object' || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 1 || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('The saved reference context could not be read.')
  return { content: validateContent(value.content), version: value.version, updatedAt: value.updatedAt }
}

/** Saves context only if it has not changed since the editor loaded it. */
export function saveReferenceContext(projectId: string | null, content: unknown, expectedVersion: unknown): ReferenceContextDocument {
  const validated = validateContent(content)
  if (typeof expectedVersion !== 'number' || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid context version. Reload the saved context and try again.')
  return runInTransaction(() => {
    const current = readReferenceContext(projectId)
    if (current.version !== expectedVersion) throw new Error('This context changed in another window. Reload the saved context before saving again.')
    const document: ReferenceContextDocument = { content: validated, version: current.version + 1, updatedAt: new Date().toISOString() }
    run('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', [contextKey(projectId), JSON.stringify(document)])
    return document
  })
}

/** Takes a bounded context snapshot for a recording or retrieved Assistant sources. */
export function referenceContextSnapshot(projectId: string | null, recordingIds: string[] = []): ReferenceContextSnapshot {
  const global = readReferenceContext(null).content
  const ids = [...new Set(recordingIds)].slice(0, 6)
  const rows = projectId !== null
    ? queryAll<{ id: string; name: string }>('SELECT id,name FROM projects WHERE id=?', [projectId])
    : ids.length ? queryAll<{ id: string; name: string }>(`SELECT DISTINCT p.id,p.name FROM projects p JOIN recordings r ON r.project_id=p.id WHERE r.id IN (${ids.map(() => '?').join(',')}) ORDER BY p.name,p.id`, ids) : []
  const projects = rows.map(project => ({
    ...project,
    recordingIds: ids.length ? queryAll<{ id: string }>(`SELECT id FROM recordings WHERE project_id=? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, [project.id, ...ids]).map(row => row.id) : [],
    content: readReferenceContext(project.id).content
  }))
  return { global, projects }
}
