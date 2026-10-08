declare module 'sherpa-onnx-node' {
  export interface OfflineRecognizerResult { text: string; lang?: string; segment_texts?: string[]; segment_timestamps?: number[]; segment_durations?: number[] }
  export interface OfflineStream { acceptWaveform(value: { sampleRate: number; samples: Float32Array }): void }
  export interface OfflineRecognizerConfig { featConfig: { sampleRate: number; featureDim: number }; modelConfig: { whisper: { encoder: string; decoder: string; language: string; task: 'transcribe'; tailPaddings: number; enableSegmentTimestamps: 1; enableTokenTimestamps: 0 }; tokens: string; numThreads: number; provider: 'cpu'; debug: boolean } }
  export class OfflineRecognizer {
    static createAsync(config: OfflineRecognizerConfig): Promise<OfflineRecognizer>
    createStream(): OfflineStream
    decodeAsync(stream: OfflineStream): Promise<OfflineRecognizerResult>
  }
  export interface DiarizationTurn { start: number; end: number; speaker: number }
  export class OfflineSpeakerDiarization {
    constructor(config: { segmentation: { pyannote: { model: string; windowShiftRatio: number }; numThreads: number; provider: string; debug: boolean }; embedding: { model: string; numThreads: number; provider: string; debug: boolean }; clustering: { numClusters: number; threshold: number }; minDurationOn: number; minDurationOff: number })
    readonly sampleRate: number
    process(samples: Float32Array): DiarizationTurn[]
  }
  export interface EmbeddingStream { acceptWaveform(value: { samples: Float32Array; sampleRate: number }): void; inputFinished(): void }
  export class SpeakerEmbeddingExtractor {
    constructor(config: { model: string; numThreads: number; provider: string; debug: boolean })
    readonly dim: number
    createStream(): EmbeddingStream
    isReady(stream: EmbeddingStream): boolean
    compute(stream: EmbeddingStream, enableExternalBuffer?: boolean): Float32Array
  }
  export function readWave(path: string, enableExternalBuffer?: boolean): { samples: Float32Array; sampleRate: number }
  const native: { OfflineRecognizer: typeof OfflineRecognizer; OfflineSpeakerDiarization: typeof OfflineSpeakerDiarization; SpeakerEmbeddingExtractor: typeof SpeakerEmbeddingExtractor; readWave: typeof readWave }
  export default native
}
