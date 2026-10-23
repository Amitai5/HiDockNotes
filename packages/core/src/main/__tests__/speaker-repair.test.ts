import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDetail, initializeDatabase, queryAll, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import { repairFragmentedSpeakers, repairRecordingSpeakers } from '../ai/speaker-repair'
import { embeddingBytes } from '../ai/voice-matching'

describe('repairing saved participant fragmentation', () => {
  beforeEach(() => initializeDatabase(':memory:'))
  afterEach(closeDatabase)
  function fixture(): string {
    const row = upsertRecordingFromDevice({ filename: 'synthetic.hda', size: 100, duration: 300, dateCreated: new Date('2026-10-07T10:00:00Z') })
    for (let index = 0; index < 240; index++) {
      run('INSERT INTO speakers(id,recording_id,label,embedding) VALUES (?,?,?,?)', [`speaker-${index}`, row.id, `Speaker ${index + 1}`, index % 3 ? embeddingBytes(index % 2 ? [0, 1] : [1, 0]) : null])
      run('INSERT INTO segments(id,recording_id,start,end,text,speaker_id) VALUES (?,?,?,?,?,?)', [`segment-${index}`, row.id, index, index + 0.8, `Original words ${index}`, `speaker-${index}`])
    }
    run('INSERT INTO speakers(id,recording_id,label) VALUES (?,?,?)', ['orphan', row.id, 'Obsolete speaker'])
    run('INSERT INTO transcripts(id,recording_id,text) VALUES (?,?,?)', ['transcript', row.id, 'Original words'])
    return row.id
  }
  it('repairs active identities without deleting or changing any words or timestamps, and is idempotent', () => {
    const id = fixture(), before = getDetail(id).segments.map(({ id, start, end, text }) => ({ id, start, end, text }))
    expect(repairFragmentedSpeakers()).toBe(1)
    const detail = getDetail(id)
    expect(detail.speakers!.length).toBeLessThanOrEqual(10)
    expect(detail.segments.map(({ id, start, end, text }) => ({ id, start, end, text }))).toEqual(before)
    expect(queryOne('SELECT id FROM speakers WHERE id=?', ['orphan'])).toBeUndefined()
    expect(repairRecordingSpeakers(id)).toBe(false)
    expect(queryOne<{ transcript: string }>('SELECT transcript FROM recording_fts')?.transcript).toContain('Original words 239')
  })
  it('preserves manually named speakers, their original embedding and all voice sample provenance', () => {
    const id = fixture(), original = embeddingBytes([1, 0])
    run("INSERT INTO voice_profiles VALUES ('profile','Dana Lee','2026-10-07T10:00:00Z')")
    run("UPDATE speakers SET label='Dana Lee',label_source='manual',voice_profile_id='profile',embedding=? WHERE id='speaker-1'", [original])
    run("INSERT INTO voice_samples(id,voice_profile_id,embedding,source_recording,created_at,speaker_id) VALUES ('sample','profile',?,?,?,'speaker-1')", [original, id, '2026-10-07T10:00:00Z'])
    repairRecordingSpeakers(id)
    expect(queryOne('SELECT label,embedding,label_source,voice_profile_id FROM speakers WHERE id=?', ['speaker-1'])).toEqual({ label: 'Dana Lee', embedding: original, label_source: 'manual', voice_profile_id: 'profile' })
    expect(queryAll('SELECT id,speaker_id FROM voice_samples')).toEqual([{ id: 'sample', speaker_id: 'speaker-1' }])
    expect(getDetail(id).speakers!.filter(speaker => speaker.label === 'Dana Lee')).toHaveLength(1)
  })
  it('excludes obsolete speaker rows from current participants without discarding confirmed voice samples', () => {
    const id = fixture()
    run("INSERT INTO voice_profiles VALUES ('profile','Dana Lee','2026-10-07T10:00:00Z')")
    run("UPDATE speakers SET label_source='manual' WHERE id='orphan'")
    run("INSERT INTO voice_samples(id,voice_profile_id,embedding,source_recording,created_at,speaker_id) VALUES ('sample','profile',?,?,?,'orphan')", [embeddingBytes([1, 0]), id, '2026-10-07T10:00:00Z'])
    expect(getDetail(id).speakers!.some(speaker => speaker.id === 'orphan')).toBe(false)
    repairRecordingSpeakers(id)
    expect(queryOne('SELECT id FROM speakers WHERE id=?', ['orphan'])).toBeDefined()
    expect(getDetail(id).speakers!.some(speaker => speaker.id === 'orphan')).toBe(false)
  })
})
