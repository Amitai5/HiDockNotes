import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import type { AISettings, ProviderId } from '../../../src/shared/ai'
import type { RecordingStatus, TranscriptSegment } from '../../../src/shared/contracts'
import { convertAudioFile } from '../services/audio-playback'
import { analyzeAudioPreflight, type AudioPreflightReport } from '../services/audio-preflight'
import { alignTranscript, deterministicId, planChunks, stitchChunk } from './alignment'
import { boundDiarizedAudio, isDiarizedAudio, type DiarizedAudio } from './local-diarization'
import { ModelCache, sha256File } from './model-cache'
import { matchVoice, type VoiceCandidate, type VoiceMatch } from './voice-matching'
import type { ProviderFactory, SummaryResult, TimedText, TranscriptionResult } from './providers'
import { ProcessingError } from './errors'
import { isTranscriptionResult, readProcessingCache, writeProcessingCache } from './processing-cache'
import { summarizeMeeting } from './meeting-summary'
import { diarizeRecording } from './recording-diarization'
import type { ReferenceContextSnapshot } from '../../../src/shared/reference-context'
import { detectSpeech, filterSpeechTranscript, isSpeechIntervals } from './local-speech'

export interface ProcessingInput { id: string; path: string; checksum: string; dataPath: string; settings: AISettings; keys: Record<ProviderId, string | null>; profiles: VoiceCandidate[]; chatgptProfileId?: string; summaryReady?: boolean; recordedAt?: string; generation?: string; expectedSpeakers?: number; savedTranscript?: TranscriptCheckpoint; referenceContext?: ReferenceContextSnapshot }
export interface ProcessedSpeaker extends VoiceMatch { id: string; embedding: number[] | null }
export interface TranscriptCheckpoint { segments: TranscriptSegment[]; speakers: ProcessedSpeaker[]; duration: number; speakerLimitReached?: boolean }
export interface ProcessingResult extends TranscriptCheckpoint { summary: SummaryResult | null; empty: boolean; transcriptChanged?: boolean }
export interface BackendObserver { stage(stage: RecordingStatus, progress: number, message: string): void; checkpoint(value: TranscriptCheckpoint): void }
export interface TranscriptionBackend { process(input: ProcessingInput, observer: BackendObserver, signal?: AbortSignal): Promise<ProcessingResult> }
interface CachedTranscript extends DiarizedAudio { signature: string; items: TimedText[]; words: boolean }
const execute = promisify(execFile)
function isPreflight(value: unknown): value is AudioPreflightReport {
  if (!value || typeof value !== 'object') return false
  const report = value as AudioPreflightReport
  return ['speech_present', 'no_speech'].includes(report.status) && Number.isFinite(report.durationSeconds) && report.durationSeconds > 0 && Array.isArray(report.activityIntervals) && report.activityIntervals.every(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.start >= 0 && interval.end > interval.start && interval.end <= report.durationSeconds)
}

export class LocalTranscriptionBackend implements TranscriptionBackend {
  constructor(private readonly providers: ProviderFactory, private readonly diarize = diarizeRecording, private readonly models: (folder: string) => Pick<ModelCache, 'ensure' | 'ensureSpeech'> = folder => new ModelCache(folder), private readonly speech = detectSpeech) {}
  async process(input: ProcessingInput, observer: BackendObserver, signal?: AbortSignal): Promise<ProcessingResult> {
    const { settings } = input
    const transcriptionKey = settings.transcription.provider === 'local' ? undefined : input.keys[settings.transcription.provider], chatKey = settings.chat.provider === 'chatgpt' ? undefined : input.keys[settings.chat.provider]
    if ((!input.savedTranscript && settings.transcription.provider !== 'local' && !transcriptionKey) || (input.summaryReady !== false && (settings.chat.provider === 'chatgpt' ? !input.chatgptProfileId : !chatKey))) throw new ProcessingError('Configure the selected transcription and summary providers in Settings.')
    if (input.savedTranscript) {
      if (!input.savedTranscript.segments.length || input.summaryReady === false) throw new ProcessingError('A saved transcript and a configured summary provider are required.')
      const summary = await summarizeMeeting(this.providers(settings.chat.provider, chatKey ?? undefined), settings.chat.model, input.savedTranscript.segments, settings, input.recordedAt, (progress, message) => observer.stage('summarizing', progress, message), signal, input.referenceContext)
      return { ...input.savedTranscript, summary, empty: false, transcriptChanged: false }
    }
    observer.stage('converting', 0, 'Checking the verified audio and converting to 16 kHz mono…')
    if (await sha256File(input.path) !== input.checksum) throw new ProcessingError('The saved audio changed after verification. Download or import a clean copy before transcribing.')
    const signature = createHash('sha256').update(JSON.stringify([input.checksum, settings.transcription, settings.language, 'speech-v4-speakers-v3', input.expectedSpeakers, ...(input.generation ? [input.generation] : [])])).digest('hex')
    const folder = join(input.dataPath, 'cache', 'transcription', input.id, signature)
    await mkdir(folder, { recursive: true })
    let transcript = await readProcessingCache(join(folder, 'transcript.json')) as CachedTranscript | null
    if (!transcript || transcript.signature !== signature || !Array.isArray(transcript.items) || !Array.isArray(transcript.turns) || !Array.isArray(transcript.embeddings)) {
      // Audio and voice analysis are independent of the chosen transcription
      // model. Reuse verified work across retries and model changes.
      const analysisSignature = createHash('sha256').update(JSON.stringify([input.checksum, 'audio-preflight-v1', 'pyannote-3.0-eres2net-v1'])).digest('hex')
      const analysisFolder = join(input.dataPath, 'cache', 'analysis', input.id, analysisSignature)
      const preflightPath = join(analysisFolder, 'preflight.json')
      const wav = await convertAudioFile(input.path, 'audio', analysisFolder, signal)
      const savedPreflight = await readProcessingCache(preflightPath)
      const preflight = isPreflight(savedPreflight) ? savedPreflight : await analyzeAudioPreflight(wav)
      if (!isPreflight(savedPreflight)) await writeProcessingCache(preflightPath, preflight)
      if (preflight.status === 'no_speech') return { segments: [], speakers: [], duration: preflight.durationSeconds, summary: null, empty: true }
      const speechPath = join(analysisFolder, 'speech-v1.json'), savedSpeech = await readProcessingCache(speechPath)
      observer.stage('converting', 0.5, 'Checking which sections contain speech locally…')
      const speechModel = isSpeechIntervals(savedSpeech, preflight.durationSeconds) ? null : await this.models(join(input.dataPath, 'models', 'speech-v1')).ensureSpeech(message => observer.stage('converting', 0.5, message), signal)
      const speech = isSpeechIntervals(savedSpeech, preflight.durationSeconds) ? savedSpeech : await this.speech(wav, speechModel!, signal, fraction => observer.stage('converting', 0.5 + fraction * 0.5, 'Detecting speech locally…'))
      if (!isSpeechIntervals(savedSpeech, preflight.durationSeconds)) await writeProcessingCache(speechPath, speech)
      if (!speech.length) return { segments: [], speakers: [], duration: preflight.durationSeconds, summary: null, empty: true }
      const provider = this.providers(settings.transcription.provider, transcriptionKey ?? undefined)
      if (provider.prepare) {
        observer.stage('transcribing', 0, 'Preparing local transcription models…')
        await provider.prepare(settings.transcription.model, message => observer.stage('transcribing', 0, message), signal)
      }
      const speakerPath = join(analysisFolder, `speakers-v3-${input.expectedSpeakers ?? 'auto'}.json`), savedSpeakers = await readProcessingCache(speakerPath)
      let diarized: DiarizedAudio
      if (isDiarizedAudio(savedSpeakers, preflight.durationSeconds)) {
        diarized = boundDiarizedAudio(savedSpeakers)
        observer.stage('diarizing', 1, 'Reusing saved local speaker analysis…')
      } else {
        observer.stage('diarizing', 0, 'Preparing local speaker models…')
        const models = await this.models(join(input.dataPath, 'models', 'speaker-v1')).ensure((message, progress) => observer.stage('diarizing', progress * 0.2, message), signal)
        observer.stage('diarizing', 0.2, 'Finding speaker turns locally. Progress is saved after each section…')
        diarized = boundDiarizedAudio(await this.diarize(wav, models, signal, (fraction, message) => observer.stage('diarizing', 0.2 + fraction * 0.8, message), { expectedSpeakers: input.expectedSpeakers, activityIntervals: speech, read: index => readProcessingCache(join(analysisFolder, `speaker-v3-${index}.json`)), write: (index, audio) => writeProcessingCache(join(analysisFolder, `speaker-v3-${index}.json`), audio) }))
        signal?.throwIfAborted()
        await writeProcessingCache(speakerPath, diarized)
      }
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
        if (!speech.some(t => t.end > chunk.keepStart && t.start < chunk.keepEnd)) continue
        const path = join(folder, `chunk-${index}.wav`), resultPath = join(folder, `chunk-${index}.json`)
        let result = await readProcessingCache(resultPath) as TranscriptionResult | null
        if (!isTranscriptionResult(result, chunk.end - chunk.start)) {
          if (!ffmpegPath) throw new ProcessingError('The bundled audio converter is unavailable.')
          await execute(ffmpegPath.replace('app.asar', 'app.asar.unpacked'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(chunk.start), '-i', wav, '-t', String(chunk.end - chunk.start), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', path], { windowsHide: true, signal, maxBuffer: 100000 })
          result = await provider.transcribe(settings.transcription.model, { path, duration: chunk.end - chunk.start, language: settings.language, ...(settings.transcription.provider === 'local' ? { checkpointDirectory: join(folder, `chunk-${index}-sections`), activityIntervals: speech.filter(activity => activity.end > chunk.start && activity.start < chunk.end).map(activity => ({ start: Math.max(0, activity.start - chunk.start), end: Math.min(chunk.end, activity.end) - chunk.start })) } : {}), progress: (message, fraction = 0) => observer.stage('transcribing', (index + Math.max(0, Math.min(1, fraction))) / chunks.length, `Part ${index + 1} of ${chunks.length} · ${message}`) }, signal)
          await writeProcessingCache(resultPath, result)
        }
        words = words && result.words.length > 0
        const stitched = stitchChunk(result.words.length ? result.words : result.segments, chunk)
        items.push(...filterSpeechTranscript(stitched, speech))
      }
      if (!items.length) throw new ProcessingError('No timestamped speech was returned. Check the audio and selected language, then retry.')
      transcript = { ...diarized, signature, items, words }
      await writeProcessingCache(join(folder, 'transcript.json'), transcript)
    }
    transcript = { ...transcript, ...boundDiarizedAudio(transcript) }
    observer.stage('identifying', 0, 'Comparing local voice samples…')
    const names = new Map<number, string>()
    const speakers = transcript.embeddings.map((item, index) => {
      const match = matchVoice(item.vector, input.profiles, `Unknown speaker ${index + 1}`, settings.suggestThreshold, settings.autoAssignThreshold)
      names.set(item.speaker, match.label)
      // Native cluster numbers can swap when the count or analysis changes.
      // Bind manual labels to the actual voice/turns, never to an ordinal slot.
      const identity = createHash('sha256').update(JSON.stringify([item.vector, transcript!.turns.filter(turn => turn.speaker === item.speaker).map(turn => [turn.start, turn.end])])).digest('hex')
      return { ...match, id: deterministicId(`${input.id}:speaker:speech-v3:${identity}`), embedding: item.vector }
    })
    const speakerIds = new Map(transcript.embeddings.map((item, index) => [deterministicId(`${input.id}:speaker:${item.speaker}`), speakers[index].id]))
    const segments = alignTranscript(input.id, transcript.items, transcript.turns, names, transcript.words).map(segment => ({ ...segment, speakerId: segment.speakerId ? speakerIds.get(segment.speakerId) ?? null : null }))
    const checkpoint = { segments, speakers, duration: transcript.duration, speakerLimitReached: transcript.speakerLimitReached }
    observer.checkpoint(checkpoint)
    if (input.summaryReady === false) return { ...checkpoint, summary: null, empty: false }
    observer.stage('summarizing', 0, 'Creating a title, summary and action items…')
    const chat = this.providers(settings.chat.provider, chatKey ?? undefined)
    const summary = await summarizeMeeting(chat, settings.chat.model, segments, settings, input.recordedAt, (progress, message) => observer.stage('summarizing', progress, message), signal, input.referenceContext)
    return { ...checkpoint, summary, empty: false }
  }
}
