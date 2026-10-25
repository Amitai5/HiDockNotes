import { randomUUID } from 'node:crypto'
import type { AssistantAnswer, ChatMessage, SourceCitation } from '../../../src/shared/ai'
import type { ConversationDetail, ConversationView, SavedChatMessage } from '../../../src/shared/conversations'
import { queryAll, queryOne, run, runInTransaction } from './database'

interface ConversationRow { id: string; title: string; project_id: string | null; project_name: string | null; created_at: string; updated_at: string; version: number; message_count: number; draft: string }
interface MessageRow { id: string; ordinal: number; role: ChatMessage['role']; content: string; citations: string; created_at: string }
interface Dependencies { answer(question: string, project: string | null, history: ChatMessage[], signal: AbortSignal): Promise<AssistantAnswer>; changed(id: string): void; now?: () => Date }
const CONVERSATIONS = 'SELECT c.*,p.name AS project_name,(SELECT count(*) FROM assistant_messages m WHERE m.conversation_id=c.id) AS message_count FROM assistant_conversations c LEFT JOIN projects p ON p.id=c.project_id'
const PAGE_SIZE = 80

/** Stores complete question/answer pairs; failed or cancelled requests cannot leave half an exchange. */
export class AssistantConversations {
  private readonly active = new Map<string, { controller: AbortController; task: Promise<ConversationDetail> }>()
  private readonly now: () => Date
  constructor(private readonly dependencies: Dependencies) { this.now = dependencies.now ?? (() => new Date()) }
  current(): ConversationDetail | null {
    const selected = queryOne<{ value: string }>("SELECT value FROM settings WHERE key='assistant-active-conversation'")
    const id = selected ? JSON.parse(selected.value) as string : null
    const row = id ? queryOne<{ id: string }>('SELECT id FROM assistant_conversations WHERE id=?', [id]) : undefined
    const latest = row ?? queryOne<{ id: string }>('SELECT id FROM assistant_conversations ORDER BY updated_at DESC,id LIMIT 1')
    return latest ? this.get(latest.id) : null
  }
  select(id: string): ConversationDetail { const detail = this.get(id); run("INSERT OR REPLACE INTO settings(key,value) VALUES ('assistant-active-conversation',?)", [JSON.stringify(id)]); return detail }
  list(search = ''): ConversationView[] {
    const pattern = '%' + search.replace(/[\\%_]/g, value => '\\' + value) + '%'
    return queryAll<ConversationRow>(`${CONVERSATIONS} WHERE (?='' OR c.title LIKE ? ESCAPE '\\' OR c.draft LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM assistant_messages m WHERE m.conversation_id=c.id AND m.content LIKE ? ESCAPE '\\')) ORDER BY c.updated_at DESC,c.id LIMIT 100`, [search, pattern, pattern, pattern]).map(row => this.view(row))
  }
  create(projectId: string | null): ConversationDetail {
    if (projectId && !queryOne('SELECT id FROM projects WHERE id=?', [projectId])) throw new Error('Project was not found.')
    const id = randomUUID(), date = this.now().toISOString()
    run("INSERT INTO assistant_conversations(id,title,project_id,created_at,updated_at) VALUES (?,'New chat',?,?,?)", [id, projectId, date, date])
    this.dependencies.changed(id)
    return this.select(id)
  }
  get(id: string, before?: number): ConversationDetail {
    const conversation = this.view(this.row(id))
    const rows = queryAll<MessageRow>('SELECT * FROM assistant_messages WHERE conversation_id=? AND ordinal<? ORDER BY ordinal DESC LIMIT ?', [id, before ?? Number.MAX_SAFE_INTEGER, PAGE_SIZE + 1])
    return { conversation, hasEarlier: rows.length > PAGE_SIZE, messages: rows.slice(0, PAGE_SIZE).reverse().map(row => ({ id: row.id, ordinal: row.ordinal, role: row.role, content: row.content, citations: JSON.parse(row.citations) as SourceCitation[], createdAt: row.created_at })) }
  }
  rename(id: string, title: string, version: number): ConversationDetail {
    this.assertIdle(id)
    if (!title.trim()) throw new Error('Enter a chat name.')
    if (!run('UPDATE assistant_conversations SET title=?,title_manual=1,version=version+1 WHERE id=? AND version=?', [title.trim(), id, version]).changes) throw new Error('This chat changed. Reopen it before saving.')
    this.dependencies.changed(id); return this.get(id)
  }
  remove(id: string): void { this.assertIdle(id); this.row(id); run('DELETE FROM assistant_conversations WHERE id=?', [id]); this.dependencies.changed(id) }
  send(id: string, question: string, version: number): Promise<ConversationDetail> {
    if (this.active.size) return Promise.reject(new Error('Wait for the current answer to finish, or stop it first.'))
    const row = this.row(id)
    if (row.version !== version) return Promise.reject(new Error('This chat changed. Reopen it before sending.'))
    if (!question.trim()) return Promise.reject(new Error('Ask a question about your library sources.'))
    run('UPDATE assistant_conversations SET draft=? WHERE id=?', [question.trim(), id])
    const controller = new AbortController()
    const task = Promise.resolve().then(() => this.answer(row, question.trim(), controller.signal))
    this.active.set(id, { controller, task }); this.dependencies.changed(id)
    void task.finally(() => { this.active.delete(id); this.dependencies.changed(id) }).catch(() => undefined)
    return task
  }
  cancel(id: string): void { this.active.get(id)?.controller.abort() }
  async stop(): Promise<void> { for (const request of this.active.values()) request.controller.abort(); await Promise.allSettled([...this.active.values()].map(value => value.task)) }
  private async answer(row: ConversationRow, question: string, signal: AbortSignal): Promise<ConversationDetail> {
    const history = queryAll<SavedChatMessage>('SELECT role,content FROM assistant_messages WHERE conversation_id=? ORDER BY ordinal DESC LIMIT 6', [row.id]).reverse()
    const answer = await this.dependencies.answer(question, row.project_id, history, signal)
    signal.throwIfAborted()
    if (!answer.text.trim() || answer.text.length > 200000 || answer.citations.length > 6) throw new Error('The answer is too large to save. Try a more focused question.')
    const date = this.now().toISOString()
    runInTransaction(() => {
      if (answer.citations.some(citation => citation.kind!=='note' && !queryOne('SELECT id FROM recordings WHERE id=?', [citation.recordingId]))) throw new Error('A source recording was deleted while the answer was being prepared. Please ask again.')
      for(const citation of answer.citations)if(citation.kind==='note'){
        if(!/^[a-zA-Z0-9_-]{1,80}$/.test(citation.noteId)||!Number.isSafeInteger(citation.revision)||citation.revision<1||!/^[a-zA-Z0-9_-]{1,80}$/.test(citation.blockId)||typeof citation.excerpt!=='string'||citation.excerpt.length>6000)throw Error('The written-note citation is invalid.')
        const current=queryOne<{revision:number}>('SELECT revision FROM written_notes WHERE id=?',[citation.noteId]);if(!current||current.revision<citation.revision)throw Error('A source note was deleted while the answer was being prepared. Please ask again.')
      }
      if (!run("UPDATE assistant_conversations SET updated_at=?,version=version+1,draft='',title=CASE WHEN title_manual=0 AND version=0 THEN ? ELSE title END WHERE id=? AND version=?", [date, question.replace(/\s+/g, ' ').slice(0, 90), row.id, row.version]).changes) throw new Error('This chat changed while the answer was being prepared. Your saved messages were kept.')
      const ordinal = queryOne<{ last: number }>('SELECT COALESCE(max(ordinal),-1) AS last FROM assistant_messages WHERE conversation_id=?', [row.id])!.last + 1
      for (const [offset, role, content, citations] of [[0, 'user', question, []], [1, 'assistant', answer.text, answer.citations]] as const) run('INSERT INTO assistant_messages(id,conversation_id,ordinal,role,content,citations,created_at) VALUES (?,?,?,?,?,?,?)', [randomUUID(), row.id, ordinal + offset, role, content, JSON.stringify(citations), date])
    })
    const detail = this.get(row.id)
    return { ...detail, conversation: { ...detail.conversation, responding: false } }
  }
  private row(id: string): ConversationRow { const row = queryOne<ConversationRow>(`${CONVERSATIONS} WHERE c.id=?`, [id]); if (!row) throw new Error('Chat was not found.'); return row }
  private view(row: ConversationRow): ConversationView { return { id: row.id, title: row.title, projectId: row.project_id, projectName: row.project_name, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version, messageCount: row.message_count, responding: this.active.has(row.id), draft: row.draft } }
  private assertIdle(id: string): void { if (this.active.has(id)) throw new Error('Stop the answer before changing this chat.') }
}
