import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDetail, initializeDatabase, queryAll, queryOne, run, upsertRecordingFromDevice } from '../services/database'
import { assignSegment, confirmSpeaker, deleteVoiceProfile, deleteVoiceSample, listVoiceProfiles, MAX_VOICE_SAMPLES, mergeVoiceProfiles, nameSpeaker, renameVoiceProfile, voiceCandidates } from '../ai/voices'
import { embeddingBytes } from '../ai/voice-matching'
import { deterministicId } from '../ai/alignment'

describe('local remembered voices', () => {
  beforeEach(() => initializeDatabase(':memory:'))
  afterEach(closeDatabase)
  function fixture(number = 0): { id: string; speaker: string } {
    const recording = upsertRecordingFromDevice({ filename: `call-${number}.hda`, size: 200, duration: 10, dateCreated: new Date('2026-10-07T10:00:00Z') })
    const speaker = deterministicId(`speaker-${number}`)
    run('INSERT INTO speakers(id, recording_id, label, embedding) VALUES (?, ?, ?, ?)', [speaker, recording.id, 'Speaker 1', embeddingBytes([1, 0])])
    run('INSERT INTO segments(id, recording_id, start, end, text, speaker_id) VALUES (?, ?, 0, 2, ?, ?)', [deterministicId(`segment-${number}`), recording.id, 'Discuss the budget', speaker])
    run('INSERT INTO transcripts(id, recording_id, text) VALUES (?, ?, ?)', [deterministicId(`transcript-${number}`), recording.id, 'Speaker 1: Discuss the budget'])
    return { id: recording.id, speaker }
  }
  it('renames the speaker throughout the transcript and enrolls one clean local sample', () => {
    const recording = fixture()
    nameSpeaker(recording.speaker, 'Dana')
    expect(getDetail(recording.id).segments[0].speakerName).toBe('Dana')
    expect(listVoiceProfiles()[0]).toMatchObject({ name: 'Dana', samples: [{ recordingId: recording.id }] })
    expect(voiceCandidates()[0].embeddings[0]).toEqual([1, 0])
    expect(queryOne<{ text: string }>('SELECT text FROM transcripts')?.text).toContain('Dana')
    nameSpeaker(recording.speaker, 'Dana')
    expect(listVoiceProfiles()[0].samples).toHaveLength(1)
  })
  it('assigns only the requested unidentified segment, validates ownership and never enrolls uncertain audio', () => {
    const first = fixture(1), other = fixture(2), segment = deterministicId('segment-1')
    run('UPDATE segments SET speaker_id=NULL WHERE id=?', [segment])
    expect(() => assignSegment(other.id, segment, 'Dana')).toThrow('not found')
    assignSegment(first.id, segment, 'Dana')
    expect(getDetail(first.id).segments[0].speakerName).toBe('Dana')
    expect(queryOne('SELECT id FROM voice_samples')).toBeUndefined()
    expect(getDetail(other.id).segments[0].speakerName).toBe('Speaker 1')
  })
  it('corrects a wrong label by moving only that speaker sample', () => {
    const first = fixture(1), second = fixture(2)
    nameSpeaker(first.speaker, 'Alex'); nameSpeaker(second.speaker, 'Alex')
    nameSpeaker(first.speaker, 'Dana')
    expect(listVoiceProfiles().find(p => p.name === 'Alex')?.samples).toHaveLength(1)
    expect(listVoiceProfiles().find(p => p.name === 'Dana')?.samples[0].recordingId).toBe(first.id)
  })
  it('confirms a suggestion as a named sample', () => {
    const first = fixture(1), second = fixture(2)
    nameSpeaker(first.speaker, 'Dana')
    const profile = listVoiceProfiles()[0]
    run('UPDATE speakers SET suggested_profile_id=? WHERE id=?', [profile.id, second.speaker])
    confirmSpeaker(second.speaker)
    expect(getDetail(second.id).segments[0].speakerName).toBe('Dana')
    expect(listVoiceProfiles()[0].samples).toHaveLength(2)
  })
  it('bounds confirmed samples without growing forever', () => {
    for (let index = 0; index < MAX_VOICE_SAMPLES + 3; index++) nameSpeaker(fixture(index).speaker, 'Dana')
    expect(listVoiceProfiles()[0].samples).toHaveLength(MAX_VOICE_SAMPLES)
  })
  it('merges and renames profiles while keeping transcript labels and search synchronized', () => {
    const first = fixture(1), second = fixture(2)
    nameSpeaker(first.speaker, 'Dana'); nameSpeaker(second.speaker, 'D. Jones')
    const profiles = listVoiceProfiles()
    const target = profiles.find(p => p.name === 'Dana')!, source = profiles.find(p => p.name === 'D. Jones')!
    mergeVoiceProfiles(source.id, target.id)
    renameVoiceProfile(target.id, 'Dana Jones')
    expect(listVoiceProfiles()).toHaveLength(1)
    expect(listVoiceProfiles()[0].samples).toHaveLength(2)
    expect(getDetail(second.id).segments[0].speakerName).toBe('Dana Jones')
    expect(queryAll<{ transcript: string }>('SELECT transcript FROM recording_fts').every(row => row.transcript.includes('Dana Jones'))).toBe(true)
  })
  it('deletes samples and profiles without deleting audio or transcript labels', () => {
    const recording = fixture()
    nameSpeaker(recording.speaker, 'Dana')
    const profile = listVoiceProfiles()[0]
    deleteVoiceSample(profile.samples[0].id)
    expect(listVoiceProfiles()[0].samples).toHaveLength(0)
    deleteVoiceProfile(profile.id)
    expect(listVoiceProfiles()).toHaveLength(0)
    expect(getDetail(recording.id).segments[0].speakerName).toBe('Dana')
    expect(queryOne('SELECT id FROM recordings')).toBeDefined()
  })
})
