import { queryAll, queryOne, run, runInTransaction } from './database'
import { validateId } from '../ipc/jensen-validation'

export function setRecordingTags(id: string, value: unknown): void {
  validateId(id)
  if (!Array.isArray(value) || value.length > 20) throw new Error('Use up to 20 tags per recording.')
  const seen = new Set<string>()
  const tags: string[] = []
  for (const input of value) {
    if (typeof input !== 'string' || !input.trim() || input.trim().length > 40 || /[\u0000-\u001f]/.test(input)) throw new Error('Each tag must contain between 1 and 40 characters.')
    const tag = input.trim()
    if (!seen.has(tag.toLowerCase())) { seen.add(tag.toLowerCase()); tags.push(tag) }
  }
  if (!queryOne('SELECT id FROM recordings WHERE id=?', [id])) throw new Error('Recording was not found.')
  const previous = new Map(queryAll<{ tag: string; source: string }>('SELECT tag,source FROM recording_tags WHERE recording_id=?', [id]).map(row => [row.tag, row.source]))
  runInTransaction(() => {
    run('DELETE FROM recording_tags WHERE recording_id=?', [id])
    for (const tag of tags) run('INSERT INTO recording_tags(recording_id,tag,source) VALUES (?,?,?)', [id, tag, previous.get(tag) ?? 'manual'])
  })
}

export function assignRecordingProject(id: string, project: string | null): void {
  validateId(id)
  if (project !== null) {
    validateId(project)
    if (!queryOne('SELECT id FROM projects WHERE id=?', [project])) throw new Error('The project folder no longer exists.')
  }
  if (!run('UPDATE recordings SET project_id=? WHERE id=?', [project, id]).changes) throw new Error('Recording was not found.')
}
