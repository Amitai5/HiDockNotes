import type { ProviderFactory } from './providers'
import { GeminiProvider } from './gemini-provider'
import { OpenAIProvider } from './openai-provider'
import { ChatGPTProvider } from './chatgpt-provider'
import { ProcessingError } from './errors'
import { LocalWhisperProvider } from './local-whisper-provider'
import { WhisperModelCache } from './whisper-model-cache'

export function providerFactory(chatgptToken?: () => Promise<string>, blocked?: (message: string) => void, sessionSignal?: () => AbortSignal, localModelFolder?: string, whisperCache?: Pick<WhisperModelCache, 'ensure'>): ProviderFactory {
  return (provider, key) => {
    if (provider === 'local') {
      return new LocalWhisperProvider({ cache: whisperCache ?? (localModelFolder ? new WhisperModelCache(localModelFolder) : { ensure: async () => { throw new ProcessingError('Local transcription must run in the recording worker.') } }) })
    }
    if (provider === 'chatgpt') {
      if (!chatgptToken) throw new ProcessingError('Connect your ChatGPT account in Settings before using your plan.')
      return new ChatGPTProvider(chatgptToken, undefined, blocked, sessionSignal)
    }
    if (!key) throw new ProcessingError('Verify the selected provider API key in Settings.')
    return provider === 'gemini' ? new GeminiProvider(key) : new OpenAIProvider(key)
  }
}
export const createProvider = providerFactory()
