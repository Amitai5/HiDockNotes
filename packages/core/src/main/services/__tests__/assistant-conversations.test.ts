import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantConversations } from '../assistant-conversations'
import { closeDatabase, createProject, initializeDatabase, queryOne, run, upsertRecordingFromDevice } from '../database'
import type { AssistantAnswer } from '../../../../src/shared/ai'

const date = '2026-10-21T10:00:00.000Z'
let service: AssistantConversations, recordingId: string
const answer = vi.fn(), changed = vi.fn()
beforeEach(() => {
  initializeDatabase(':memory:'); changed.mockReset(); answer.mockReset()
  recordingId = upsertRecordingFromDevice({ filename: 'meeting.hda', size: 2, duration: 20, dateCreated: new Date(date) }).id
  answer.mockResolvedValue({ text: 'Send the plan. [1]', citations: [{ number: 1, recordingId, title: 'Meeting', start: 3, excerpt: 'Please send the plan.' }] })
  service = new AssistantConversations({ answer, changed, now: () => new Date(date) })
})
afterEach(async () => { await service.stop(); closeDatabase() })
describe('saved Assistant conversations', () => {
  it('persists complete exchanges, project scope, citation snapshots, and the selected conversation', async () => {
    const project = createProject('Work'), chat = service.create(project.id)
    const saved = await service.send(chat.conversation.id, 'What should I do?', 0)
    expect(saved.conversation).toMatchObject({ title: 'What should I do?', projectId: project.id, projectName: 'Work', version: 1, messageCount: 2, responding: false })
    expect(saved.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(saved.messages[1].citations[0]).toMatchObject({ recordingId, start: 3, excerpt: 'Please send the plan.' })
    const reopened = new AssistantConversations({ answer, changed })
    expect(reopened.current()?.messages).toEqual(saved.messages)
    expect(answer).toHaveBeenCalledWith('What should I do?', project.id, [], expect.any(AbortSignal))
  })
  it('uses only the saved recent exchanges when answering a follow-up', async () => {
    const chat = service.create(null)
    await service.send(chat.conversation.id, 'First question', 0)
    await service.send(chat.conversation.id, 'Who owns it?', 1)
    expect(answer.mock.calls[1][2]).toEqual([{ role: 'user', content: 'First question' }, { role: 'assistant', content: 'Send the plan. [1]' }])
    expect(service.get(chat.conversation.id).conversation.messageCount).toBe(4)
  })
  it('keeps a manual chat title and rejects stale edits or sends', async () => {
    const chat = service.create(null)
    service.rename(chat.conversation.id, 'Intake follow-ups', 0)
    expect(() => service.rename(chat.conversation.id, 'Stale title', 0)).toThrow('changed')
    await expect(service.send(chat.conversation.id, 'Question', 0)).rejects.toThrow('changed')
    await service.send(chat.conversation.id, 'Question', 1)
    expect(service.get(chat.conversation.id).conversation.title).toBe('Intake follow-ups')
  })
  it('does not save half an exchange when the provider fails', async () => {
    const chat = service.create(null); answer.mockRejectedValueOnce(new Error('Provider unavailable'))
    await expect(service.send(chat.conversation.id, 'Question', 0)).rejects.toThrow('Provider unavailable')
    expect(service.get(chat.conversation.id)).toMatchObject({ messages: [], conversation: { version: 0, responding: false, draft: 'Question' } })
    expect(new AssistantConversations({ answer, changed }).current()?.conversation.draft).toBe('Question')
  })
  it('blocks overlapping requests and aborts an answer without erasing earlier messages', async () => {
    const chat = service.create(null); await service.send(chat.conversation.id, 'Saved question', 0)
    answer.mockImplementationOnce((_question, _project, _history, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true })))
    const pending = service.send(chat.conversation.id, 'Pending question', 1)
    await Promise.resolve()
    expect(service.get(chat.conversation.id).conversation.responding).toBe(true)
    expect(() => service.remove(chat.conversation.id)).toThrow('Stop the answer')
    await expect(service.send(chat.conversation.id, 'Duplicate', 1)).rejects.toThrow('current answer')
    service.cancel(chat.conversation.id)
    await expect(pending).rejects.toThrow('Cancelled')
    expect(service.get(chat.conversation.id).messages).toHaveLength(2)
  })
  it('keeps both saved messages intact when another write changes the conversation', async () => {
    const chat = service.create(null)
    answer.mockImplementationOnce(async () => { run('UPDATE assistant_conversations SET version=version+1 WHERE id=?', [chat.conversation.id]); return { text: 'Answer', citations: [] } })
    await expect(service.send(chat.conversation.id, 'Question', 0)).rejects.toThrow('changed while')
    expect(service.get(chat.conversation.id).messages).toEqual([])
  })
  it('redacts stored answers and citation excerpts when a source recording is deleted', async () => {
    const chat = service.create(null); await service.send(chat.conversation.id, 'Question', 0)
    run('DELETE FROM recordings WHERE id=?', [recordingId])
    const saved = service.get(chat.conversation.id)
    expect(saved.messages[0].content).toBe('Question')
    expect(saved.messages[1]).toMatchObject({ content: 'This answer was removed because a source recording was deleted.', citations: [] })
    expect(saved.conversation.version).toBe(2)
  })
  it('refuses a late answer whose source was deleted while it was being generated', async () => {
    const chat = service.create(null)
    answer.mockImplementationOnce(async () => { run('DELETE FROM recordings WHERE id=?', [recordingId]); return { text: 'Private quote [1]', citations: [{ number: 1, recordingId, title: 'Deleted', start: 0, excerpt: 'Private quote' }] } as AssistantAnswer })
    await expect(service.send(chat.conversation.id, 'Question', 0)).rejects.toThrow('source recording was deleted')
    expect(service.get(chat.conversation.id).messages).toEqual([])
  })
  it('paginates long conversations without losing older messages and searches their contents literally', async () => {
    const chat = service.create(null)
    answer.mockResolvedValue({ text: 'Answer with 100% of the details.', citations: [] })
    for (let index = 0; index < 45; index++) await service.send(chat.conversation.id, 'Question ' + index, index)
    const latest = service.get(chat.conversation.id), earlier = service.get(chat.conversation.id, latest.messages[0].ordinal)
    expect(latest.messages).toHaveLength(80); expect(latest.hasEarlier).toBe(true)
    expect(earlier.messages).toHaveLength(10); expect(earlier.hasEarlier).toBe(false)
    expect(earlier.messages[0].content).toBe('Question 0')
    service.create(null)
    expect(service.list('%').map(item => item.id)).toEqual([chat.conversation.id])
  })
  it('deletes a chat and its messages while preserving recordings', async () => {
    const chat = service.create(null); await service.send(chat.conversation.id, 'Question', 0)
    service.remove(chat.conversation.id)
    expect(service.current()).toBeNull()
    expect(queryOne('SELECT id FROM assistant_messages')).toBeUndefined()
    expect(queryOne('SELECT id FROM recordings')).toEqual({ id: recordingId })
  })
})
