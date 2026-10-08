import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import type { AISettings, ProviderId } from '../../../src/shared/ai'
import type { RecordingStatus, TranscriptSegment } from '../../../src/shared/contracts'
import { convertAudioFile } from '../services/audio-playback'
import { analyzeAudioPreflight } from '../services/audio-preflight'
import { alignTranscript, deterministicId, planChunks, stitchChunk } from './alignment'
import { diarizeAudio, type DiarizedAudio } from './local-diarization'
import { ModelCache, sha256File } from './model-cache'
import { matchVoice, type VoiceCandidate, type VoiceMatch } from './voice-matching'
import type { ProviderFactory, SummaryResult, TimedText, TranscriptionResult } from './providers'
import { ProcessingError } from './errors'

export interface ProcessingInput { id: string; path: string; checksum: string; dataPath: string; settings: AISettings; keys: Record<ProviderId, string | null>; profiles: VoiceCandidate[]; chatgptProfileId?: string; summaryReady?: boolean }
export interface ProcessedSpeaker extends VoiceMatch { id: string; embedding: number[] | null }
export interface TranscriptCheckpoint { segments: TranscriptSegment[]; speakers: ProcessedSpeaker[]; duration: number }
export interface ProcessingResult extends TranscriptCheckpoint { summary: SummaryResult | null; empty: boolean }
export interface BackendObserver { stage(stage: RecordingStatus, progress: number, message: string): void; checkpoint(value: TranscriptCheckpoint): void }
export interface TranscriptionBackend { process(input: ProcessingInput, observer: BackendObserver, signal?: AbortSignal): Promise<ProcessingResult> }
interface CachedTranscript extends DiarizedAudio { signature: string; items: TimedText[]; words: boolean }
const execute = promisify(execFile)
async function cached<T>(path: string): Promise<T | null> { try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return null } }
async function saveCache(path: string, value: unknown): Promise<void> { const staged = path + '.partial'; await writeFile(staged, JSON.stringify(value), { mode: 0o600 }); await rename(staged, path) }

export class LocalTranscriptionBackend implements TranscriptionBackend {
  constructor(private readonly providers: ProviderFactory, private readonly diarize = diarizeAudio, private readonly models = (folder: string) => new ModelCache(folder)) {}
  async process(input: ProcessingInput, observer: BackendObserver, signal?: AbortSignal): Promise<ProcessingResult> {
    const { settings } = input
    const transcriptionKey = settings.transcription.provider === 'local' ? undefined : input.keys[settings.transcription.provider], chatKey = settings.chat.provider === 'chatgpt' ? undefined : input.keys[settings.chat.provider]
    if ((settings.transcription.provider !== 'local' && !transcriptionKey) || (input.summaryReady !== false && (settings.chat.provider === 'chatgpt' ? !input.chatgptProfileId : !chatKey))) throw new ProcessingError('Configure the selected transcription and summary providers in Settings.')
    observer.stage('converting', 0, 'Checking the verified audio and converting to 16 kHz mono…')
    if (await sha256File(input.path) !== input.checksum) throw new ProcessingError('The saved audio changed after verification. Download or import a clean copy before transcribing.')
    const signature = createHash('sha256').update(JSON.stringify([input.checksum, settings.transcription, settings.language, 'pyannote-3.0-eres2net-v1'])).digest('hex')
    const folder = join(input.dataPath, 'cache', 'transcription', input.id, signature)
    await mkdir(folder, { recursive: true })
    let transcript = await cached<CachedTranscript>(join(folder, 'transcript.json'))
    if (!transcript || transcript.signature !== signature || !Array.isArray(transcript.items) || !Array.isArray(transcript.turns) || !Array.isArray(transcript.embeddings)) {
      const wav = await convertAudioFile(input.path, 'audio', folder, signal)
      const preflight = await analyzeAudioPreflight(wav)
      if (preflight.status === 'no_speech') return { segments: [], speakers: [], duration: preflight.durationSeconds, summary: null, empty: true }
      const provider = this.providers(settings.transcription.provider, transcriptionKey ?? undefined)
      if (provider.prepare) {
        observer.stage('transcribing', 0, 'Preparing local transcription models…')
        await provider.prepare(settings.transcription.model, message => observer.stage('transcribing', 0, message), signal)
      }
      observer.stage('diarizing', 0, 'Preparing local speaker models…')
      const models = await this.models(join(input.dataPath, 'models', 'speaker-v1')).ensure((message, progress) => observer.stage('diarizing', progress * 0.2, message), signal)
      observer.stage('diarizing', 0.2, 'Finding speaker turns locally. Long recordings can take several minutes…')
      const diarized = await this.diarize(wav, models, signal, (fraction, message) => observer.stage('diarizing', 0.2 + fraction * 0.8, message))
      if (!diarized.turns.length) {
        // Keep timestamped speech editable even when the local model cannot
        // separate voices. This fallback never enrolls an unrecognized voice.
        diarized.turns = [{ start: 0, end: diarized.duration, speaker: 0 }]
        diarized.embeddings = [{ speaker: 0, vector: null }]
      }
      const items: TimedText[] = []
      let words = settings.transcription.model !== 'gpt-4o-transcribe-diarize'
      const chunks = planChunks(diarized.duration)
      for (let index = 0; index < chunks.length; index++) {
        signal?.throwIfAborted()
        const chunk = chunks[index]
        observer.stage('transcribing', index / chunks.length, `Transcribing part ${index + 1} of ${chunks.length}…`)
        if (!preflight.activityIntervals.some(t => t.end > chunk.keepStart && t.start < chunk.keepEnd)) continue
        const path = join(folder, `chunk-${index}.wav`), resultPath = join(folder, `chunk-${index}.json`)
        let result = await cached<TranscriptionResult>(resultPath)
        if (!result || !Array.isArray(result.words) || !Array.isArray(result.segments)) {
          if (!ffmpegPath) throw new ProcessingError('The bundled audio converter is unavailable.')
          await execute(ffmpegPath.replace('app.asar', 'app.asar.unpacked'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(chunk.start), '-i', wav, '-t', String(chunk.end - chunk.start), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', path], { windowsHide: true, signal, maxBuffer: 100000 })
          result = await provider.transcribe(settings.transcription.model, { path, duration: chunk.end - chunk.start, language: settings.language, progress: (message, fraction = 0) => observer.stage('transcribing', (index + Math.max(0, Math.min(1, fraction))) / chunks.length, `Part ${index + 1} of ${chunks.length} · ${message}`) }, signal)
          await saveCache(resultPath, result)
        }
        words = words && result.words.length > 0
        items.push(...stitchChunk(result.words.length ? result.words : result.segments, chunk))
      }
      if (!items.length) throw new ProcessingError('No timestamped speech was returned. Check the audio and selected language, then retry.')
      transcript = { ...diarized, signature, items, words }
      await saveCache(join(folder, 'transcript.json'), transcript)
    }
    observer.stage('identifying', 0, 'Comparing local voice samples…')
    const names = new Map<number, string>()
    const speakers = transcript.embeddings.map((item, index) => {
      const match = matchVoice(item.vector, input.profiles, `Speaker ${index + 1}`, settings.suggestThreshold, settings.autoAssignThreshold)
      names.set(item.speaker, match.label)
      return { ...match, id: deterministicId(`${input.id}:speaker:${item.speaker}`), embedding: item.vector }
    })
    const segments = alignTranscript(input.id, transcript.items, transcript.turns, names, transcript.words)
    const checkpoint = { segments, speakers, duration: transcript.duration }
    observer.checkpoint(checkpoint)
    if (input.summaryReady === false) return { ...checkpoint, summary: null, empty: false }
    observer.stage('summarizing', 0, 'Creating a title, summary and action items…')
    const chat = this.providers(settings.chat.provider, chatKey ?? undefined)
    // Keep the entire transcript: summarize large recordings in bounded parts,
    // then combine their summaries and preserve their timestamped action items.
    const parts: TranscriptSegment[][] = [[]]
    let characters = 0
    for (const segment of segments) {
      if (characters + segment.text.length > 60000 && parts[parts.length - 1].length) { parts.push([]); characters = 0 }
      parts[parts.length - 1].push(segment); characters += segment.text.length + 80
    }
    const summaries: SummaryResult[] = []
    for (let index = 0; index < parts.length; index++) {
      observer.stage('summarizing', index / parts.length, `Summarizing part ${index + 1} of ${parts.length}…`)
      summaries.push(await chat.summarize(settings.chat.model, parts[index], settings, signal))
    }
    let summary = summaries[0]
    if (summaries.length > 1) {
      summary = await chat.summarize(settings.chat.model, summaries.map((part, index) => ({ id: String(index), start: parts[index][0].start, end: parts[index][parts[index].length - 1].end, text: part.summary, speakerId: null, speakerName: null })), settings, signal)
      summary.actionItems = summaries.flatMap(s => s.actionItems).filter((item, index, all) => all.findIndex(other => other.text.toLocaleLowerCase() === item.text.toLocaleLowerCase()) === index)
    }
    return { ...checkpoint, summary, empty: false }
  }
}
