import { GoogleGenAI } from '@google/genai'
import { DEFAULT_MODELS, type AISettings, type ModelChoice } from '../../../src/shared/ai'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import { ProcessingError, providerError } from './errors'
import { parseGeminiTranscript, parseSummary } from './provider-parsing'
import { SUMMARY_SCHEMA, summaryInstructions, summaryContent, type AudioChunk, type ProviderClient, type SummaryContext, type SummaryResult, type TranscriptionResult } from './providers'

export class GeminiProvider implements ProviderClient {
  private readonly client: GoogleGenAI
  constructor(key: string, client?: GoogleGenAI) { this.client = client ?? new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 180000 } }) }
  async listModels(): Promise<ModelChoice[]> {
    try {
      const result = await this.client.models.list({ config: { pageSize: 100, httpOptions: { timeout: 30000 } } })
      const models: ModelChoice[] = []
      for await (const item of result) {
        const id = item.name?.replace(/^models\//, '')
        if (!id) continue
        const builtIn = DEFAULT_MODELS.gemini.find(m => m.id === id)
        if (builtIn) models.push(builtIn)
        else if (id.startsWith('gemini-') && item.supportedActions?.includes('generateContent') && !/(tts|image|live|robotics|computer-use|embedding|transcribe)/.test(id)) models.push({ id, name: item.displayName ?? id, transcription: false, chat: true })
        if (models.length >= 500) break
      }
      // Some accounts list generateContent models only. Interactions transcription
      // is a separate documented API; retain its built-in option in that case.
      if (!models.some(m => m.transcription)) models.push(DEFAULT_MODELS.gemini[0])
      return models.sort((a, b) => a.id.localeCompare(b.id))
    } catch (error) { throw providerError(error) }
  }
  async transcribe(model: string, chunk: AudioChunk, signal?: AbortSignal): Promise<TranscriptionResult> {
    if (model !== 'gemini-3.5-transcribe') throw new ProcessingError('Choose Gemini 3.5 Transcribe for word timestamps.')
    let name: string | undefined
    try {
      const file = await this.client.files.upload({ file: chunk.path, config: { mimeType: 'audio/wav', abortSignal: signal } })
      name = file.name
      if (!name || !file.uri) throw new ProcessingError('Gemini did not accept the audio upload.', true)
      let state = file.state
      const deadline = Date.now() + 120000
      while (state === 'PROCESSING') {
        signal?.throwIfAborted()
        if (Date.now() > deadline) throw new ProcessingError('Gemini took too long to prepare the audio. Retry shortly.', true)
        await new Promise<void>(resolve => setTimeout(resolve, 1000))
        state = (await this.client.files.get({ name, config: { abortSignal: signal } })).state
      }
      if (state === 'FAILED') throw new ProcessingError('Gemini could not read the uploaded audio.')
      const result = await this.client.interactions.create({
        model, store: false,
        input: [{ type: 'audio', uri: file.uri, mime_type: 'audio/wav' }],
        generation_config: { transcription_config: { language_codes: chunk.language === 'auto' ? undefined : [chunk.language], mode: { type: 'verbatim', timestamp_granularities: ['word'] } } }
      }, { signal })
      return parseGeminiTranscript(result, chunk.duration)
    } catch (error) { if (error instanceof ProcessingError) throw error; throw providerError(error) }
    finally { if (name) await this.client.files.delete({ name }).catch(() => undefined) }
  }
  async summarize(model: string, segments: TranscriptSegment[], settings: AISettings, signal?: AbortSignal, context?: SummaryContext): Promise<SummaryResult> {
    try {
      const response = await this.client.models.generateContent({ model, contents: summaryContent(segments, context), config: { systemInstruction: summaryInstructions(settings, context), responseMimeType: 'application/json', responseJsonSchema: SUMMARY_SCHEMA, maxOutputTokens: 6000, abortSignal: signal } })
      return parseSummary(response.text ?? '', Math.max(0, ...segments.map(s => s.end)), context?.evidenceSegments ?? segments)
    } catch (error) { if (error instanceof ProcessingError) throw error; throw providerError(error) }
  }
  async chat(model: string, instructions: string, content: string, signal?: AbortSignal): Promise<string> {
    try {
      const response = await this.client.models.generateContent({ model, contents: content, config: { systemInstruction: instructions, maxOutputTokens: 4000, abortSignal: signal } })
      if (!response.text) throw new ProcessingError('The provider returned an empty answer.', true)
      return response.text
    } catch (error) { if (error instanceof ProcessingError) throw error; throw providerError(error) }
  }
}
