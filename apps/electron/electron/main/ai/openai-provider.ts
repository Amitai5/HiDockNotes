import OpenAI from 'openai'
import { createReadStream } from 'node:fs'
import { DEFAULT_MODELS, type AISettings, type ModelChoice } from '../../../src/shared/ai'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import { providerError, ProcessingError } from './errors'
import { parseOpenAITranscript, parseSummary } from './provider-parsing'
import { SUMMARY_SCHEMA, summaryInstructions, summaryContent, type AudioChunk, type ProviderClient, type SummaryContext, type SummaryResult, type TranscriptionResult } from './providers'

export class OpenAIProvider implements ProviderClient {
  private readonly client: OpenAI
  constructor(key: string, client?: OpenAI) { this.client = client ?? new OpenAI({ apiKey: key, timeout: 180000, maxRetries: 0, logLevel: 'off' }) }
  async listModels(): Promise<ModelChoice[]> {
    try {
      const page = await this.client.models.list({ timeout: 30000 })
      const models = page.data.map(m => m.id)
      return models.flatMap(id => {
        const builtIn = DEFAULT_MODELS.openai.find(m => m.id === id)
        if (builtIn) return [builtIn]
        if (/^(gpt-|o[134])/.test(id) && !/(audio|transcribe|realtime|image|tts|search|codex|instruct|embedding|moderation)/.test(id)) return [{ id, name: id, transcription: false, chat: true }]
        return []
      }).sort((a, b) => a.id.localeCompare(b.id))
    } catch (error) { throw providerError(error) }
  }
  async transcribe(model: string, chunk: AudioChunk, signal?: AbortSignal): Promise<TranscriptionResult> {
    if (!DEFAULT_MODELS.openai.some(m => m.id === model && m.transcription)) throw new ProcessingError('Choose a timestamp-capable OpenAI model.')
    const file = createReadStream(chunk.path)
    try {
      const language = chunk.language === 'auto' ? undefined : chunk.language.split('-')[0]
      const response = model === 'whisper-1'
        ? await this.client.audio.transcriptions.create({ file, model, response_format: 'verbose_json', timestamp_granularities: ['word', 'segment'], language }, { signal })
        : await this.client.audio.transcriptions.create({ file, model, response_format: 'diarized_json', chunking_strategy: 'auto', language }, { signal })
      return parseOpenAITranscript(response, chunk.duration)
    } catch (error) { if (error instanceof ProcessingError) throw error; throw providerError(error) }
    finally { file.destroy() }
  }
  async summarize(model: string, segments: TranscriptSegment[], settings: AISettings, signal?: AbortSignal, context?: SummaryContext): Promise<SummaryResult> {
    try {
      const response = await this.client.responses.create({ model, store: false, instructions: summaryInstructions(settings, context), input: summaryContent(segments, context), text: { format: { type: 'json_schema', name: 'recording_summary', strict: true, schema: SUMMARY_SCHEMA } }, max_output_tokens: 6000 }, { signal })
      return parseSummary(response.output_text, Math.max(0, ...segments.map(s => s.end)), context?.evidenceSegments ?? segments)
    } catch (error) { if (error instanceof ProcessingError) throw error; throw providerError(error) }
  }
  async chat(model: string, instructions: string, content: string, signal?: AbortSignal): Promise<string> {
    try {
      const result = await this.client.responses.create({ model, store: false, instructions, input: content, max_output_tokens: 4000 }, { signal })
      if (!result.output_text) throw new ProcessingError('The provider returned an empty answer.', true)
      return result.output_text
    } catch (error) { if (error instanceof ProcessingError) throw error; throw providerError(error) }
  }
}
