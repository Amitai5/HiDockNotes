import { ProcessingError } from './errors'
import type { TimedText } from './providers'

export interface SpeechInterval { start: number; end: number }
/** Only unambiguous decoder markers and sustained numeric/symbol loops. */
export function decoderArtifactReason(text: string): 'non-speech-marker' | 'numeric-decoder-loop' | null {
  const value = text.trim()
  if (/^\[(?:ambient|silence|music|background noise|blank_audio|no speech)\]$/i.test(value)) return 'non-speech-marker'
  // Do not suppress repeated natural words or an ordinary measurement. The
  // observed decoder failure contains almost exclusively numbers and "x".
  if (/[\p{L}]/u.test(value.replace(/x/gi, ''))) return null
  const tokens = value.toLowerCase().match(/\d+(?:[./]\d+)?|x/g) ?? []
  if (tokens.length < 16) return null
  for (let offset = 0; offset <= 4; offset++) {
    for (let period = 1; period <= 4; period++) {
      if ((tokens.length - offset) / period < 6) continue
      if (tokens.slice(offset).every((token, index) => token === tokens[offset + index % period])) return 'numeric-decoder-loop'
    }
  }
  return null
}
export function hasSpeechSupport(item: SpeechInterval, speech: SpeechInterval[]): boolean {
  const overlap = speech.reduce((sum, turn) => sum + Math.max(0, Math.min(item.end, turn.end + 0.15) - Math.max(item.start, turn.start - 0.15)), 0)
  return overlap >= Math.min(0.12, (item.end - item.start) * 0.1)
}
/** Filters non-speech decoder output; legitimate short acknowledgements remain when speech is detected. */
export function filterSpeechTranscript(items: TimedText[], speech: SpeechInterval[]): TimedText[] {
  const rejected = new Set<TimedText>()
  // A decoder loop in a mostly non-speech gap can contain a few coincidental
  // VAD hits. Reject the whole sustained loop, not every use of a filler word.
  for (let start = 0; start < items.length;) {
    const word = items[start].text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
    let end = start + 1
    while (word.length > 0 && word.length <= 12 && end < items.length && items[end].text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') === word && items[end].start - items[end - 1].end <= 1.5) end++
    if (end - start >= 6) {
      const span = { start: items[start].start, end: items[end - 1].end }
      const supported = speech.reduce((sum, turn) => sum + Math.max(0, Math.min(span.end, turn.end) - Math.max(span.start, turn.start)), 0)
      if (supported / (span.end - span.start) < 0.3) for (const item of items.slice(start, end)) rejected.add(item)
    }
    start = end
  }
  return items.filter(item => !rejected.has(item) && !decoderArtifactReason(item.text) && hasSpeechSupport(item, speech))
}
export function isSpeechIntervals(value: unknown, duration: number): value is SpeechInterval[] {
  return Array.isArray(value) && value.every(turn => turn && Number.isFinite(turn.start) && Number.isFinite(turn.end) && turn.start >= 0 && turn.end > turn.start && turn.end <= duration)
}
export async function detectSpeech(path: string, model: string, signal?: AbortSignal, progress: (fraction: number) => void = () => undefined): Promise<SpeechInterval[]> {
  const { default: sherpa } = await import('sherpa-onnx-node')
  signal?.throwIfAborted()
  const audio = sherpa.readWave(path, false)
  if (audio.sampleRate !== 16000 || !audio.samples.length) throw new ProcessingError('Speech detection requires 16 kHz mono audio.')
  const detector = new sherpa.Vad({ sileroVad: { model, threshold: 0.45, minSilenceDuration: 0.35, minSpeechDuration: 0.1, windowSize: 512, maxSpeechDuration: 15 }, sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: false }, 30)
  const duration = audio.samples.length / 16000, intervals: SpeechInterval[] = []
  function drain(): void {
    while (!detector.isEmpty()) {
      const turn = detector.front(false), start = Math.max(0, turn.start / 16000), end = Math.min(duration, (turn.start + turn.samples.length) / 16000)
      if (end > start) intervals.push({ start, end })
      detector.pop()
    }
  }
  for (let offset = 0; offset < audio.samples.length; offset += 512) {
    signal?.throwIfAborted()
    detector.acceptWaveform(audio.samples.subarray(offset, offset + 512)); drain()
    if (offset % (512 * 1000) === 0) { progress(offset / audio.samples.length); await new Promise<void>(resolve => setImmediate(resolve)) }
  }
  detector.flush(); drain(); progress(1)
  return intervals
}
