import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, getDatabase, getDetail, initializeDatabase, listRecordings, queryAll, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import { findDecoderArtifacts, quarantineDecoderArtifacts, repairSavedDecoderArtifacts } from '../ai/transcript-repair'

beforeEach(() => initializeDatabase(':memory:'))
afterEach(closeDatabase)
function fixture(provider = 'local'): string {
  const row = upsertRecordingFromDevice({ filename: provider + '.hda', size: 100, duration: 100, dateCreated: new Date('2026-10-05T10:00:00Z') })
  run("INSERT INTO speakers(id,recording_id,label,label_source) VALUES (?,?,'Dana','manual')", [provider, row.id])
  for (const [index, text] of ['Ordinary words.', '1/2" ' + 'x 2" '.repeat(50), 'Okay.', '[BLANK_AUDIO]'].entries()) run('INSERT INTO segments VALUES (?,?,?,?,?,?)', [`${provider}-${index}`, row.id, index * 10, index * 10 + 5, text, provider])
  run('INSERT INTO transcripts(id,recording_id,text,provider) VALUES (?,?,?,?)', [provider, row.id, 'Ordinary words. x 2 [BLANK_AUDIO]', provider])
  run('INSERT INTO summaries(id,recording_id,text) VALUES (?,?,?)', [provider, row.id, 'Original summary'])
  run('INSERT INTO recording_tags(recording_id,tag) VALUES (?,?)', [row.id, 'original-tag'])
  run("INSERT INTO actionables(id,recording_id,text,done) VALUES (?,?,'Already completed task',1)", [provider, row.id])
  return row.id
}
describe('legacy local transcript artifact recovery', () => {
  it('removes only unmistakable artifacts, updates search, and keeps recovery rows and all other metadata', () => {
    const id = fixture(), original = getDetail(id).segments
    expect(findDecoderArtifacts()).toHaveLength(2)
    expect(quarantineDecoderArtifacts(findDecoderArtifacts(), '2026-10-13T10:00:00Z')).toBe(1)
    expect(getDetail(id).segments).toEqual([original[0], original[2]])
    expect(listRecordings('BLANK_AUDIO')).toEqual([])
    expect(listRecordings('Ordinary')).toHaveLength(1)
    expect(queryAll('SELECT text,start,end,speaker_id FROM transcript_artifacts ORDER BY start')).toEqual(original.filter((_, index) => index === 1 || index === 3).map(s => ({ text: s.text, start: s.start, end: s.end, speaker_id: s.speakerId })))
    expect(getDetail(id)).toMatchObject({ recording: { summary: 'Original summary' }, tags: ['original-tag'], actionables: [{ done: true }], speakers: [{ label: 'Dana' }] })
    expect(quarantineDecoderArtifacts(findDecoderArtifacts(), '2026-10-13T10:00:00Z')).toBe(0)
  })
  it('does not modify cloud transcripts or delete a segment that changed after scanning', () => {
    fixture('openai'); fixture()
    const artifacts = findDecoderArtifacts()
    expect(artifacts).toHaveLength(2)
    run("UPDATE segments SET text='User corrected words' WHERE id=?", [artifacts[0].segment_id])
    quarantineDecoderArtifacts(artifacts, '2026-10-13T10:00:00Z')
    expect(queryOne<{ text: string }>('SELECT text FROM segments WHERE id=?', [artifacts[0].segment_id])?.text).toBe('User corrected words')
    expect(getDetail(queryOne<{ id: string }>("SELECT id FROM recordings WHERE filename='openai.hda'")!.id).segments).toHaveLength(4)
  })
  it('does not change any saved transcript if the safety backup fails', async () => {
    const id = fixture(), before = getDetail(id)
    const backup = vi.spyOn(getDatabase(), 'backup').mockRejectedValue(new Error('Disk full'))
    await expect(repairSavedDecoderArtifacts('/synthetic')).rejects.toThrow('Disk full')
    expect(backup).toHaveBeenCalledWith(expect.stringContaining('library-before-transcript-quality-v4-'))
    expect(getDetail(id)).toEqual(before)
    expect(queryAll('SELECT * FROM transcript_artifacts')).toEqual([])
  })
})
