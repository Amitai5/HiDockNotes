import type { TranscriptSegment } from '../shared/contracts'
import type { SpeakerView } from '../shared/ai'

const generic = /^(?:unknown(?: speaker)?|unassigned(?: speaker| speech)?|speaker)$/i
const numbered = /^(?:unknown )?speaker\s+(\d+)$/i

/** Gives legacy anonymous identities stable numbers without inventing an identity for unmatched speech. */
export function labelTranscriptSpeakers(segments: TranscriptSegment[], speakers: SpeakerView[] = []): TranscriptSegment[] {
  const labels = new Map(speakers.map(speaker => [speaker.id, speaker.label]))
  const used = new Set<number>()
  for (const name of [...segments.map(segment => segment.speakerName), ...labels.values()]) {
    const match = name?.trim().match(numbered)
    if (match) used.add(Number(match[1]))
  }
  let next = 1
  for (const segment of segments) {
    if (!segment.speakerId) continue
    const name = labels.get(segment.speakerId)?.trim() || segment.speakerName?.trim()
    if (name && !generic.test(name)) { labels.set(segment.speakerId, name); continue }
    while (used.has(next)) next++
    labels.set(segment.speakerId, `Unknown speaker ${next}`); used.add(next++)
  }
  return segments.map(segment => {
    const name = (segment.speakerId ? labels.get(segment.speakerId) : undefined) || segment.speakerName?.trim()
    const speakerName = name && !generic.test(name) ? name : 'Unassigned speech'
    return speakerName === segment.speakerName ? segment : { ...segment, speakerName }
  })
}
