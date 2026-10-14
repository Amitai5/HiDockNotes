import type { RecordingDetail } from '../shared/contracts'
import type { SpeakerView } from '../shared/ai'
import { MAX_MEETING_PARTICIPANTS } from '../shared/meeting'

export function RecordingParticipants({ detail, onEdit }: { detail: RecordingDetail; onEdit(speaker: SpeakerView): void }): JSX.Element {
  const speakers = detail.speakers ?? []
  const current = new Set(speakers.map(speaker => speaker.id))
  const described = (detail.meeting?.participants ?? []).filter(person => person.speakerId === null || current.has(person.speakerId))
  const missing = speakers.filter(speaker => !described.some(person => person.speakerId === speaker.id)).map(speaker => ({ speakerId: speaker.id, name: speaker.label, organizer: false }))
  const candidates = described.length || missing.length ? [...described, ...missing] : detail.segments.map(segment => ({ speakerId: segment.speakerId, name: segment.speakerName ?? 'Unknown speaker', organizer: false }))
  const unique = new Map<string, typeof candidates[number]>()
  for (const candidate of candidates) {
    const voice = detail.speakers?.find(speaker => speaker.id === candidate.speakerId)
    const name = voice?.profileId ? voice.label : candidate.name
    const key = name.trim().toLowerCase()
    const previous = unique.get(key)
    unique.set(key, { ...candidate, name, organizer: candidate.organizer || !!previous?.organizer })
  }
  const participants = Array.from(unique.values()).slice(0, MAX_MEETING_PARTICIPANTS)
  return <>{participants.map((participant, index) => {
    const voice = detail.speakers?.find(speaker => speaker.id === participant.speakerId)
    const label = <>{participant.name}{participant.organizer && <small className="organizer-label">Organizer</small>}</>
    return voice ? <button className="participant-chip" key={index} onClick={() => onEdit({ ...voice, label: participant.name })} title="Rename this speaker">{label}</button> : <span className="participant-chip" key={index}>{label}</span>
  })}{!participants.length && <span className="muted">No speakers identified yet</span>}</>
}
