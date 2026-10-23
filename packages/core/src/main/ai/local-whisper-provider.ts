import { availableParallelism } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { LOCAL_TRANSCRIPTION_MODELS, type AISettings, type ModelChoice } from '../../../src/shared/ai'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import { planChunks, stitchChunk } from './alignment'
import { ProcessingError } from './errors'
import { isTimedText, readProcessingCache, writeProcessingCache } from './processing-cache'
import { WhisperModelCache, whisperModelId, type WhisperModelFiles, type WhisperModelId } from './whisper-model-cache'
import type { AudioChunk, ProviderClient, SummaryResult, TimedText, TranscriptionResult } from './providers'
import type { OfflineRecognizer, OfflineRecognizerResult } from 'sherpa-onnx-node'
import { filterSpeechTranscript } from './local-speech'

type NativeRuntime = typeof import('sherpa-onnx-node')['default']
interface LocalDependencies { cache: Pick<WhisperModelCache, 'ensure'>; load?(): Promise<NativeRuntime>; threads?: number }

export function whisperLanguage(value: string): string { return value === 'auto' ? '' : value.toLowerCase().split('-')[0] }
export function whisperSegments(result: OfflineRecognizerResult, duration: number): TimedText[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new ProcessingError('Local Whisper needs a valid audio duration.')
  if (!result.text.trim()) return []
  const texts = result.segment_texts, starts = result.segment_timestamps, durations = result.segment_durations
  if (!texts?.length || !starts || !durations || texts.length !== starts.length || texts.length !== durations.length) throw new ProcessingError('Local Whisper returned speech without usable timestamps. Retry the recording.')
  const segments: TimedText[] = []
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index], start = starts[index], segmentDuration = durations[index]
    if (typeof text !== 'string') throw new ProcessingError('Local Whisper returned corrupted segment text. Retry the recording.')
    if (!text.trim()) continue
    if (!Number.isFinite(start) || !Number.isFinite(segmentDuration) || start < 0 || segmentDuration < 0) throw new ProcessingError('Local Whisper returned corrupted timing data. Retry the recording.')
    // sherpa 1.13.8 can return duration=0 for an unterminated final segment
    // because num_audio_frames is only set when token timestamps are enabled.
    // Use the next native boundary or the actual audio end, never padded audio.
    if (start >= duration) continue
    const nextStart = starts.slice(index + 1).find(time => Number.isFinite(time) && time > start && time < duration)
    const end = Math.min(duration, segmentDuration === 0 ? nextStart ?? duration : start + segmentDuration)
    if (!Number.isFinite(end) || end <= start) throw new ProcessingError('Local Whisper returned corrupted timing data. Retry the recording.')
    segments.push({ start, end, text: text.trim() })
  }
  return segments
}

export class LocalWhisperProvider implements ProviderClient {
  private recognizer: OfflineRecognizer | null = null
  private signature = ''
  private prepared: { model: WhisperModelId; files: WhisperModelFiles } | null = null
  private native: NativeRuntime | null = null
  private readonly load: () => Promise<NativeRuntime>
  constructor(private readonly dependencies: LocalDependencies) { this.load = dependencies.load ?? (async () => (await import('sherpa-onnx-node')).default) }
  async listModels(): Promise<ModelChoice[]> { return LOCAL_TRANSCRIPTION_MODELS.map(model => ({ ...model })) }
  async prepare(model: string, progress: (message: string) => void, signal?: AbortSignal): Promise<void> {
    const id = whisperModelId(model)
    this.prepared = { model: id, files: await this.dependencies.cache.ensure(id, progress, signal) }
  }
  async transcribe(model: string, chunk: AudioChunk, signal?: AbortSignal): Promise<TranscriptionResult> {
    const modelId = whisperModelId(model), language = whisperLanguage(chunk.language), progress = chunk.progress ?? (() => undefined)
    signal?.throwIfAborted()
    this.native ??= await this.load()
    signal?.throwIfAborted()
    const wave = this.native.readWave(chunk.path, false)
    if (wave.sampleRate !== 16000 || !wave.samples.length) throw new ProcessingError('Local Whisper needs non-empty 16 kHz mono audio.')
    const duration = wave.samples.length / wave.sampleRate
    const windows = planChunks(duration, 25, 1), segments: TimedText[] = []
    const cacheSignature = chunk.checkpointDirectory ? createHash('sha256').update(JSON.stringify(['whisper-speech-v4', modelId, language, chunk.activityIntervals])).update(Buffer.from(wave.samples.buffer, wave.samples.byteOffset, wave.samples.byteLength)).digest('hex') : null
    for (let index = 0; index < windows.length; index++) {
      signal?.throwIfAborted()
      const window = windows[index], sectionDuration = window.end - window.start
      if (chunk.activityIntervals && !chunk.activityIntervals.some(activity => activity.end > window.start && activity.start < window.end)) {
        progress(`Skipped silent section ${index + 1} of ${windows.length}.`, (index + 1) / windows.length)
        continue
      }
      const checkpointPath = chunk.checkpointDirectory ? join(chunk.checkpointDirectory, `${cacheSignature}-${index}.json`) : null
      const cached = checkpointPath ? await readProcessingCache(checkpointPath) : null
      let section: TimedText[]
      if (Array.isArray(cached) && cached.every(item => isTimedText(item, sectionDuration))) {
        section = cached
        progress(`Resumed saved section ${index + 1} of ${windows.length}.`, (index + 1) / windows.length)
      } else {
        if (!this.recognizer || this.signature !== modelId + ':' + language) {
          const files = this.prepared?.model === modelId ? this.prepared.files : await this.dependencies.cache.ensure(modelId, progress, signal)
          progress('Loading local Whisper on the CPU…')
          this.recognizer = await this.native.OfflineRecognizer.createAsync(this.config(files, modelId, language))
          this.signature = modelId + ':' + language
        }
        signal?.throwIfAborted()
        const stream = this.recognizer.createStream()
        progress(`Transcribing locally with Whisper: section ${index + 1} of ${windows.length}…`, index / windows.length)
        stream.acceptWaveform({ sampleRate: 16000, samples: wave.samples.subarray(Math.floor(window.start * 16000), Math.floor(window.end * 16000)) })
        const result = await this.recognizer.decodeAsync(stream)
        signal?.throwIfAborted()
        section = whisperSegments(result, sectionDuration)
        if (checkpointPath) await writeProcessingCache(checkpointPath, section)
      }
      signal?.throwIfAborted()
      const stitched = stitchChunk(section, window)
      segments.push(...(chunk.activityIntervals ? filterSpeechTranscript(stitched, chunk.activityIntervals) : stitched))
      progress(`Transcribed ${index + 1} of ${windows.length} local sections.`, (index + 1) / windows.length)
    }
    return { text: segments.map(segment => segment.text).join(' '), segments, words: [] }
  }
  async summarize(_model: string, _segments: TranscriptSegment[], _settings: AISettings): Promise<SummaryResult> { throw new ProcessingError('Local Whisper transcribes audio. Choose ChatGPT, Gemini or OpenAI for summaries.') }
  async chat(): Promise<string> { throw new ProcessingError('Local Whisper transcribes audio. Choose a chat provider for Assistant.') }
  private config(files: WhisperModelFiles, _model: WhisperModelId, language: string): Parameters<typeof OfflineRecognizer.createAsync>[0] {
    return { featConfig: { sampleRate: 16000, featureDim: 80 }, modelConfig: { whisper: { encoder: files.encoder, decoder: files.decoder, language, task: 'transcribe', tailPaddings: 300,
      // The Node binding uses integer flags. Boolean true is silently ignored.
      enableSegmentTimestamps: 1, enableTokenTimestamps: 0 }, tokens: files.tokens, numThreads: this.dependencies.threads ?? Math.max(1, Math.min(4, availableParallelism() - 1)), provider: 'cpu', debug: false } }
  }
}
