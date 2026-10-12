import OpenAI from 'openai'
import type { AISettings, ModelChoice } from '../../../src/shared/ai'
import type { TranscriptSegment } from '../../../src/shared/contracts'
import { ChatGPTPlanBlocked, ChatGPTSessionExpired, chatgptError } from './chatgpt-protocol'
import { ProcessingError } from './errors'
import { parseSummary } from './provider-parsing'
import { SUMMARY_SCHEMA, summaryInstructions, transcriptContent, type AudioChunk, type ProviderClient, type SummaryContext, type SummaryResult, type TranscriptionResult } from './providers'

export type SubscriptionClientFactory = (accessToken: string) => OpenAI
export class ChatGPTProvider implements ProviderClient {
  constructor(private readonly accessToken: () => Promise<string>, private readonly clientFactory: SubscriptionClientFactory = token => new OpenAI({ apiKey: token, baseURL: 'https://api.openai.com/v1', timeout: 180000, maxRetries: 0, logLevel: 'off' }), private readonly blocked?: (message: string) => void, private readonly sessionSignal?: () => AbortSignal) {}
  async listModels(): Promise<ModelChoice[]> { throw new ProcessingError('Load ChatGPT models from the connected account in Settings.') }
  async transcribe(_model: string, _chunk: AudioChunk): Promise<TranscriptionResult> { throw new ProcessingError('ChatGPT plan usage does not support audio transcription. Choose Gemini or OpenAI for transcription.') }
  async summarize(model: string, segments: TranscriptSegment[], settings: AISettings, signal?: AbortSignal, context?: SummaryContext): Promise<SummaryResult> {
    const text = await this.respond(model, summaryInstructions(settings, context), transcriptContent(segments), true, signal)
    return parseSummary(text, Math.max(0, ...segments.map(segment => segment.end)))
  }
  async chat(model: string, instructions: string, content: string, signal?: AbortSignal): Promise<string> { return this.respond(model, instructions, content, false, signal) }
  private async respond(model: string, instructions: string, content: string, structured: boolean, signal?: AbortSignal): Promise<string> {
    const session = this.sessionSignal?.()
    if (session) signal = signal ? AbortSignal.any([signal, session]) : session
    signal?.throwIfAborted()
    try {
      // Token renewal is owned by the main process. Obtain a fresh token for
      // every part, including after hours of local audio processing.
      const client = this.clientFactory(await this.accessToken())
      signal?.throwIfAborted()
      const stream = await client.responses.create({ model, instructions, input: [{ role: 'user', content }], store: false, stream: true, ...(structured ? { text: { format: { type: 'json_schema' as const, name: 'recording_summary', strict: true, schema: SUMMARY_SCHEMA } } } : {}) }, { signal })
      let text = '', completed = false
      for await (const event of stream) {
        signal?.throwIfAborted()
        if (event.type === 'response.output_text.delta') text += event.delta
        else if (event.type === 'response.failed') throw chatgptError(event.response.error?.code)
        else if (event.type === 'error') throw chatgptError(event.code)
        else if (event.type === 'response.incomplete') throw new ProcessingError('ChatGPT returned an incomplete answer. Retry or choose another model.', true)
        else if (event.type === 'response.completed') {
          if (event.response.status !== 'completed') throw new ProcessingError('ChatGPT did not finish the answer. Try again.', true)
          completed = true
          const final = event.response.output.flatMap(item => item.type === 'message' ? item.content.flatMap(part => part.type === 'output_text' ? [part.text] : []) : []).join('')
          if (final) text = final
        }
        if (text.length > 200000) throw new ProcessingError('The ChatGPT answer exceeded the supported size. Try a more focused request.')
      }
      if (!completed) throw new ProcessingError('The ChatGPT connection ended before the answer completed. Try again.', true)
      if (!text.trim()) throw new ProcessingError('ChatGPT returned an empty answer. Try again.', true)
      return text
    } catch (error) {
      if (signal?.aborted) throw new ProcessingError('The ChatGPT request was cancelled because the connection changed or processing stopped.')
      if (error instanceof ProcessingError) { if (error instanceof ChatGPTPlanBlocked) this.blocked?.(error.message); throw error }
      const item = error && typeof error === 'object' ? error as { status?: number; code?: string } : {}
      const errorResult = chatgptError(item.code, item.status)
      const safe = errorResult instanceof ChatGPTSessionExpired ? new ChatGPTPlanBlocked(errorResult.message) : errorResult
      if (safe instanceof ChatGPTPlanBlocked) this.blocked?.(safe.message)
      throw safe
    }
  }
}
