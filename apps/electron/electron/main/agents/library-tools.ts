import { validateId } from '../ipc/jensen-validation'
import { AGENT_TOOL_CATALOG, type AgentToolName } from './tool-catalog'

export interface AgentDatabaseReader {
  all<T>(sql: string, parameters?: unknown[]): T[]
  one<T>(sql: string, parameters?: unknown[]): T | undefined
}
interface Page { limit: number; offset: number }
interface RecordingRow { id: string; filename: string; title: string | null; recordedAt: string; durationSeconds: number | null; status: string; projectId: string | null }
interface ActionRow { id: string; text: string; done: number; recordingId: string; start: number | null; createdAt: string | null; dueDate: string | null; completedAt: string | null }
const recordingColumns = 'r.id, r.filename, r.title, r.date_recorded AS recordedAt, r.duration_seconds AS durationSeconds, r.status, r.project_id AS projectId'
const actionColumns = 'a.id, a.text, a.done, a.recording_id AS recordingId, a.start, a.created_at AS createdAt, a.due_date AS dueDate, a.completed_at AS completedAt'
const statuses = ['device-only', 'downloaded', 'queued', 'converting', 'diarizing', 'transcribing', 'identifying', 'summarizing', 'done', 'failed', 'empty']

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Pagination is outside the allowed range.')
  return value
}
function page(input: Record<string, unknown>): Page { return { limit: integer(input.limit, 20, 1, 50), offset: integer(input.offset, 0, 0, 1000000) } }
function projectClause(input: Record<string, unknown>, parameters: unknown[]): string {
  if (input.projectId === undefined) return ''
  if (input.projectId === null) return ' AND r.project_id IS NULL'
  parameters.push(validateId(input.projectId)); return ' AND r.project_id=?'
}
function boundedText(value: string, limit: number): string { return value.slice(0, limit) }
function actionable(row: ActionRow): Omit<ActionRow, 'done'> & { done: boolean } { return { ...row, text: boundedText(row.text, 2000), done: row.done === 1 } }

export class LibraryAgentTools {
  constructor(private readonly database: AgentDatabaseReader) {}
  call(name: string, value: unknown): unknown {
    const tool = AGENT_TOOL_CATALOG.find(item => item.name === name)
    if (!tool) throw new Error('Unknown or unavailable tool.')
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Tool arguments must be an object.')
    const input = (value ?? {}) as Record<string, unknown>
    if (Object.keys(input).some(key => !Object.hasOwn(tool.inputSchema.properties, key))) throw new Error('Unknown tool argument.')
    switch (name as AgentToolName) {
      case 'list_projects': return this.projects(input)
      case 'list_recordings': return this.recordings(input, false)
      case 'search_recordings': return this.recordings(input, true)
      case 'get_recording': return this.recording(input)
      case 'list_action_items': return this.actions(input)
    }
  }
  private projects(input: Record<string, unknown>): unknown {
    const { limit, offset } = page(input)
    const rows = this.database.all<{ id: string; name: string; count: number }>('SELECT p.id, p.name, count(r.id) AS count FROM projects p LEFT JOIN recordings r ON r.project_id=p.id GROUP BY p.id ORDER BY p.name, p.id LIMIT ? OFFSET ?', [limit + 1, offset])
    return { projects: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null }
  }
  private recordings(input: Record<string, unknown>, search: boolean): unknown {
    const { limit, offset } = page(input)
    const parameters: unknown[] = []
    let where = ' WHERE 1=1' + projectClause(input, parameters)
    if (search) {
      if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500 || /[\u0000-\u001f]/.test(input.query)) throw new Error('Search needs between 1 and 500 characters.')
      const terms = input.query.trim().split(/\s+/).map(term => '"' + term.replaceAll('"', '""') + '"*').join(' AND ')
      where += ' AND r.id IN (SELECT recording_id FROM recording_fts WHERE recording_fts MATCH ?)'
      parameters.push(terms)
    }
    if (input.status !== undefined) {
      if (typeof input.status !== 'string' || !statuses.includes(input.status)) throw new Error('Unknown recording status.')
      where += ' AND r.status=?'; parameters.push(input.status)
    }
    const rows = this.database.all<RecordingRow & { excerpt: string | null }>(`SELECT ${recordingColumns}, substr(COALESCE(s.text,t.text,''),1,600) AS excerpt FROM recordings r LEFT JOIN summaries s ON s.recording_id=r.id LEFT JOIN transcripts t ON t.recording_id=r.id${where} ORDER BY r.date_recorded DESC, r.id LIMIT ? OFFSET ?`, [...parameters, limit + 1, offset])
    return { recordings: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null }
  }
  private recording(input: Record<string, unknown>): unknown {
    const id = validateId(input.recordingId)
    const offset = integer(input.segmentOffset, 0, 0, 1000000)
    const limit = integer(input.segmentLimit, 50, 1, 100)
    const summaryOffset = integer(input.summaryOffset, 0, 0, 1000000)
    const recording = this.database.one<RecordingRow & { summary: string | null; summaryLength: number | null }>(`SELECT ${recordingColumns}, substr(s.text,?,24000) AS summary, length(s.text) AS summaryLength FROM recordings r LEFT JOIN summaries s ON s.recording_id=r.id WHERE r.id=?`, [summaryOffset + 1, id])
    if (!recording) throw new Error('Recording was not found.')
    const segments = this.database.all<{ start: number; end: number; text: string; speaker: string | null }>('SELECT s.start, s.end, s.text, p.label AS speaker FROM segments s LEFT JOIN speakers p ON p.id=s.speaker_id WHERE s.recording_id=? ORDER BY s.start, s.rowid LIMIT ? OFFSET ?', [id, limit + 1, offset])
    const actions = this.database.all<ActionRow>(`SELECT ${actionColumns} FROM actionables a WHERE a.recording_id=? ORDER BY a.done, a.due_date IS NULL, a.due_date, a.rowid LIMIT 101`, [id])
    const { summaryLength, ...view } = recording
    return { recording: view, nextSummaryOffset: (summaryLength ?? 0) > summaryOffset + 24000 ? summaryOffset + 24000 : null, segments: segments.slice(0, limit), nextSegmentOffset: segments.length > limit ? offset + limit : null, actionItems: actions.slice(0, 100).map(actionable), actionItemsTruncated: actions.length > 100 }
  }
  private actions(input: Record<string, unknown>): unknown {
    const { limit, offset } = page(input)
    if (input.done !== undefined && typeof input.done !== 'boolean') throw new Error('done must be a boolean.')
    const parameters: unknown[] = [input.done === true ? 1 : 0]
    const where = ' WHERE a.done=?' + projectClause(input, parameters)
    const rows = this.database.all<ActionRow>(`SELECT ${actionColumns} FROM actionables a JOIN recordings r ON r.id=a.recording_id${where} ORDER BY a.due_date IS NULL, a.due_date, a.rowid DESC LIMIT ? OFFSET ?`, [...parameters, limit + 1, offset])
    return { actionItems: rows.slice(0, limit).map(actionable), nextOffset: rows.length > limit ? offset + limit : null }
  }
}
