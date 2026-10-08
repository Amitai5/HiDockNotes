import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase, run, upsertRecordingFromDevice } from '../services/database'
import { RecordingAssistant, retrieveTranscriptContext } from '../ai/assistant'
import { CredentialVault } from '../ai/credentials'
import { DEFAULT_MODELS } from '../../../src/shared/ai'
import type { ProviderClient } from '../ai/providers'

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
