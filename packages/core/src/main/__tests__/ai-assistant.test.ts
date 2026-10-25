import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase, createProject, run, upsertRecordingFromDevice } from '../services/database'
import { RecordingAssistant, retrieveTranscriptContext } from '../ai/assistant'
import { CredentialVault } from '../ai/credentials'
import { DEFAULT_MODELS } from '../../../src/shared/ai'
import type { ProviderClient } from '../ai/providers'
import { saveReferenceContext } from '../services/reference-context'
import { EMPTY_REFERENCE_CONTEXT } from '../../../src/shared/reference-context'
import { REFERENCE_CONTEXT_RULES } from '../ai/reference-prompt'

describe('recording Assistant with SQLite FTS sources', () => {
  beforeEach(() => initializeDatabase(':memory:'))
  afterEach(closeDatabase)
  function fixture(name: string, text: string, project: string | null = null): string {
    const row = upsertRecordingFromDevice({ filename: name, size: 20, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    run('UPDATE recordings SET verified=1, project_id=? WHERE id=?', [project, row.id])
    run('INSERT INTO transcripts(id, recording_id, text) VALUES (?, ?, ?)', ['transcript-' + name, row.id, text])
    run('INSERT INTO segments(id, recording_id, start, end, text) VALUES (?, ?, 3, 6, ?)', ['segment-' + name, row.id, text])
    return row.id
  }
  it('adds global and selected-project background without sending another project context', async () => {
    const selected = createProject('Selected'), other = createProject('Other')
    const id = fixture('budget.hda', 'The budget remains under review.', selected.id)
    fixture('other.hda', 'Budget has been approved elsewhere.', other.id)
    saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, terminology: 'Shared abbreviation guide' }, 0)
    saveReferenceContext(selected.id, { ...EMPTY_REFERENCE_CONTEXT, background: 'Selected project background' }, 0)
    saveReferenceContext(other.id, { ...EMPTY_REFERENCE_CONTEXT, background: 'Unrelated private project' }, 0)
    const vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    vault.saveVerified('gemini', 'AQ.fake', DEFAULT_MODELS.gemini)
    const chat = vi.fn().mockResolvedValue('The budget remains under review. [1]')
    const answer = await new RecordingAssistant(vault, () => ({ chat } as unknown as ProviderClient)).ask('Budget?', selected.id, [])
    const request = chat.mock.calls[0]
    expect(request[1]).toContain(REFERENCE_CONTEXT_RULES)
    expect(request[2]).toContain('Shared abbreviation guide')
    expect(request[2]).toContain('Selected project background')
    expect(request[2]).not.toContain('Unrelated private project')
    expect(request[2]).toContain(`Recording ID: ${id}`)
    expect(answer.citations.map(citation => citation.recordingId)).toEqual([id])
  })
  it('maps project context to the retrieved recordings when searching the entire library', async () => {
    const first = createProject('First'), second = createProject('Second'), unrelated = createProject('Unrelated')
    const firstId = fixture('first.hda', 'First budget review.', first.id), secondId = fixture('second.hda', 'Second budget review.', second.id)
    for (const project of [first, second, unrelated]) saveReferenceContext(project.id, { ...EMPTY_REFERENCE_CONTEXT, background: project.name + ' background' }, 0)
    const vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    vault.saveVerified('gemini', 'AQ.fake', DEFAULT_MODELS.gemini)
    const chat = vi.fn().mockResolvedValue('Both budgets were reviewed. [1] [2]')
    await new RecordingAssistant(vault, () => ({ chat } as unknown as ProviderClient)).ask('Budget?', null, [])
    const content = chat.mock.calls[0][2] as string
    const reference = JSON.parse(content.slice(content.indexOf('\n') + 1, content.indexOf('\n\nLIBRARY SOURCE EXCERPTS')))
    expect(reference.projects).toEqual(expect.arrayContaining([expect.objectContaining({ id: first.id, recordingIds: [firstId] }), expect.objectContaining({ id: second.id, recordingIds: [secondId] })]))
    expect(content).not.toContain('Unrelated background')
  })
  it('does not answer from background alone when no transcript supports the question', async () => {
    saveReferenceContext(null, { ...EMPTY_REFERENCE_CONTEXT, background: 'The budget was approved by Dana.' }, 0)
    const vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    vault.saveVerified('gemini', 'AQ.fake', DEFAULT_MODELS.gemini)
    const chat = vi.fn()
    const answer = await new RecordingAssistant(vault, () => ({ chat } as unknown as ProviderClient)).ask('Was the budget approved?', null, [])
    expect(answer.citations).toEqual([])
    expect(chat).not.toHaveBeenCalled()
  })
  it('retrieves exact local transcript excerpts with source moments and project filtering', () => {
    run("INSERT INTO projects(id,name,created_at) VALUES ('project','Project','2026-10-07T10:00:00Z')")
    const id = fixture('budget.hda', 'Dana approved the budget', 'project')
    fixture('other.hda', 'Budget remains open')
    const sources = retrieveTranscriptContext('What did Dana decide about the budget?', 'project')
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ recordingId: id, start: 3, number: 1 })
    expect(sources[0].excerpt).toContain('Dana approved the budget')
  })
  it('cites retrieved recordings and refuses model-invented sources', async () => {
    const id = fixture('budget.hda', 'Dana approved the budget')
    const vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    vault.saveVerified('gemini', 'AQ.fake', DEFAULT_MODELS.gemini)
    const chat = vi.fn().mockResolvedValue('Dana approved the budget. [1]')
    const assistant = new RecordingAssistant(vault, () => ({ chat } as unknown as ProviderClient))
    expect((await assistant.ask('What about the budget?', null, [])).citations[0].recordingId).toBe(id)
    chat.mockResolvedValue('Invented source [99]')
    await expect(assistant.ask('Budget?', null, [])).rejects.toThrow('not retrieved')
  })
  it('avoids cloud calls when local search has no supporting transcript', async () => {
    const vault = new CredentialVault({ isAvailable: () => true, encrypt: value => Buffer.from(value), decrypt: value => value.toString() })
    vault.saveVerified('gemini', 'AQ.fake', DEFAULT_MODELS.gemini)
    const chat = vi.fn()
    const answer = await new RecordingAssistant(vault, () => ({ chat } as unknown as ProviderClient)).ask('A topic absent from the library', null, [])
    expect(answer.citations).toEqual([])
    expect(chat).not.toHaveBeenCalled()
  })
})
