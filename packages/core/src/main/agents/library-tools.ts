import type { WrittenNotes } from '../services/written-notes'
import type { LibraryScope, NoteSearchOptions, NoteSearchPage } from '../../../src/shared/notes'
import { validateId } from '../ipc/jensen-validation'
import { AGENT_TOOL_CATALOG, type AgentToolName } from './tool-catalog'
import { searchAgentRecordings, type AgentMeaningSearch } from './recording-search'
import type { ReferenceContextDocument } from '../../../src/shared/reference-context'
import { OUTCOME_KINDS, readMeetingOutcomes } from '../../../src/shared/meeting-outcomes'
import { isDateOnly } from '../../../src/shared/actionables'

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
interface AgentServices { notes?: WrittenNotes; noteMeaningSearch?(options:NoteSearchOptions,signal?:AbortSignal):Promise<NoteSearchPage>; meaningSearch?: AgentMeaningSearch; referenceContext?(projectId: string | null): ReferenceContextDocument }

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
  constructor(private readonly database: AgentDatabaseReader, private readonly services: AgentServices = {}) {}
  call(name: string, value: unknown, signal?: AbortSignal): unknown {
    signal?.throwIfAborted()
    const tool = AGENT_TOOL_CATALOG.find(item => item.name === name)
    if (!tool) throw new Error('Unknown or unavailable tool.')
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('Tool arguments must be an object.')
    const input = (value ?? {}) as Record<string, unknown>
    if (Object.keys(input).some(key => !Object.hasOwn(tool.inputSchema.properties, key))) throw new Error('Unknown tool argument.')
    switch (name as AgentToolName) {
      case 'list_notes': return this.notes(input)
      case 'search_notes': return this.searchNotes(input,signal)
      case 'get_note': return this.note(input)
      case 'list_projects': return this.projects(input)
      case 'list_recordings': return this.recordings(input)
      case 'search_recordings': return this.search(input, signal)
      case 'get_reference_context': return this.referenceContext(input)
      case 'list_meeting_outcomes': return this.outcomes(input)
      case 'get_recording': return this.recording(input)
      case 'list_action_items': return this.actions(input)
    }
  }
  private noteScope(input:Record<string,unknown>):LibraryScope { return input.projectId===undefined?{kind:'all'}:input.projectId===null?{kind:'unfiled'}:{kind:'project',projectId:validateId(input.projectId)} }
  private notes(input:Record<string,unknown>):unknown {
    if(!this.services.notes)throw Error('Written notes are unavailable.')
    return this.services.notes.list({scope:this.noteScope(input),limit:integer(input.limit,20,1,50),cursor:input.cursor as string|undefined})
  }
  private searchNotes(input:Record<string,unknown>,signal?:AbortSignal):unknown {
    if(!this.services.notes)throw Error('Written notes are unavailable.')
    const options:NoteSearchOptions={query:input.query as string,scope:this.noteScope(input),limit:integer(input.limit,20,1,50),cursor:input.cursor as string|undefined,mode:input.mode as 'keywords'|'meaning'|undefined}
    return options.mode==='meaning'&&this.services.noteMeaningSearch?this.services.noteMeaningSearch(options,signal):this.services.notes.search(options)
  }
  private note(input:Record<string,unknown>):unknown {
    if(!this.services.notes)throw Error('Written notes are unavailable.')
    if(input.includeDocument!==undefined&&typeof input.includeDocument!=='boolean')throw Error('includeDocument must be a boolean.')
    return this.services.notes.readPage(validateId(input.noteId),{revision:input.revision===undefined?undefined:integer(input.revision,1,1,Number.MAX_SAFE_INTEGER),limit:integer(input.limit,20,1,50),cursor:input.cursor as string|undefined,includeDocument:input.includeDocument as boolean|undefined})
  }
  private projects(input: Record<string, unknown>): unknown {
    const { limit, offset } = page(input)
    const rows = this.database.all<{ id: string; name: string; count: number }>('SELECT p.id,p.name,(SELECT count(*) FROM recordings r WHERE r.project_id=p.id) AS count,(SELECT count(*) FROM written_notes n WHERE n.project_id=p.id) AS noteCount,((SELECT count(*) FROM recordings r WHERE r.project_id=p.id)+(SELECT count(*) FROM written_notes n WHERE n.project_id=p.id)) AS itemCount FROM projects p ORDER BY p.name,p.id LIMIT ? OFFSET ?', [limit + 1, offset])
    return { projects: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null }
  }
  private recordings(input: Record<string, unknown>): unknown {
    const { limit, offset } = page(input)
    const parameters: unknown[] = []
    let where = ' WHERE 1=1' + projectClause(input, parameters)
    if (input.status !== undefined) {
      if (typeof input.status !== 'string' || !statuses.includes(input.status)) throw new Error('Unknown recording status.')
      where += ' AND r.status=?'; parameters.push(input.status)
    }
    const rows = this.database.all<RecordingRow & { excerpt: string | null }>(`SELECT ${recordingColumns}, substr(COALESCE(s.text,t.text,''),1,600) AS excerpt FROM recordings r LEFT JOIN summaries s ON s.recording_id=r.id LEFT JOIN transcripts t ON t.recording_id=r.id${where} ORDER BY r.date_recorded DESC, r.id LIMIT ? OFFSET ?`, [...parameters, limit + 1, offset])
    return { recordings: rows.slice(0, limit), nextOffset: rows.length > limit ? offset + limit : null }
  }
  private search(input: Record<string, unknown>, signal?: AbortSignal): unknown {
    const pagination = page(input)
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500 || /[\u0000-\u001f]/.test(input.query)) throw new Error('Search needs between 1 and 500 characters.')
    if (input.mode !== undefined && input.mode !== 'keywords' && input.mode !== 'meaning') throw new Error('Choose keywords or meaning search.')
    const projectId = input.projectId == null ? input.projectId as null | undefined : validateId(input.projectId)
    return searchAgentRecordings(this.database, { ...pagination, query: input.query, mode: input.mode === 'meaning' ? 'meaning' : 'keywords', projectId }, this.services.meaningSearch, signal)
  }
  private referenceContext(input: Record<string, unknown>): unknown {
    if (!this.services.referenceContext) throw new Error('Reference context is unavailable.')
    const projectId = input.projectId == null ? null : validateId(input.projectId)
    const project = projectId === null ? null : this.database.one<{ id: string; name: string }>('SELECT id,name FROM projects WHERE id=?', [projectId])
    if (projectId !== null && !project) throw new Error('Project was not found.')
    return { source: 'user_reference', isMeetingEvidence: false, global: this.services.referenceContext(null), project: project ? { ...project, ...this.services.referenceContext(project.id) } : null }
  }
  private outcomes(input: Record<string, unknown>): unknown {
    const { limit, offset } = page(input)
    const parameters: unknown[] = []
    let where = ' WHERE o.type=\'object\'' + projectClause(input, parameters)
    if (input.recordingId !== undefined) { where += ' AND r.id=?'; parameters.push(validateId(input.recordingId)) }
    if (input.kind !== undefined) {
      if (!OUTCOME_KINDS.includes(input.kind as typeof OUTCOME_KINDS[number])) throw new Error('Unknown outcome kind.')
      where += " AND json_extract(o.value,'$.kind')=?"; parameters.push(input.kind)
    }
    for (const field of ['from', 'to'] as const) {
      if (input[field] === undefined) continue
      if (!isDateOnly(input[field])) throw new Error('Use valid YYYY-MM-DD recording dates.')
      where += ` AND date(r.date_recorded)${field === 'from' ? '>=' : '<='}?`; parameters.push(input[field])
    }
    if (typeof input.from === 'string' && typeof input.to === 'string' && input.from > input.to) throw new Error('The start date must not follow the end date.')
    const rows = this.database.all<{ recordingId: string; title: string; recordedAt: string; projectId: string | null; outcome: string; summaryStale: number }>(`SELECT r.id AS recordingId,COALESCE(r.title,r.filename) AS title,r.date_recorded AS recordedAt,r.project_id AS projectId,o.value AS outcome,COALESCE(v.summary_version,0)<COALESCE((SELECT max(t.version) FROM transcript_revisions t WHERE t.recording_id=r.id),0) AS summaryStale FROM summaries s JOIN recordings r ON r.id=s.recording_id LEFT JOIN recording_overviews v ON v.recording_id=r.id JOIN json_each(s.outcomes) o${where} ORDER BY r.date_recorded DESC,r.id,CAST(o.key AS INTEGER) LIMIT ? OFFSET ?`, [...parameters, limit + 1, offset])
    return { outcomes: rows.slice(0, limit).flatMap(({ outcome, summaryStale, ...recording }) => readMeetingOutcomes('[' + outcome + ']', '').map(item => ({ ...item, ...recording, summaryStale: summaryStale === 1 }))), nextOffset: rows.length > limit ? offset + limit : null }
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
