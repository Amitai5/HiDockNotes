import { DEFAULT_AI_SETTINGS, DEFAULT_MODELS, LOCAL_TRANSCRIPTION_MODELS, type AISettings, type ChatSelection, type ProviderId } from '../../../src/shared/ai'
import { queryOne, run } from '../services/database'

export function providerId(value: unknown): ProviderId {
  if (value !== 'gemini' && value !== 'openai') throw new Error('Choose Gemini or OpenAI.')
  return value
}
function selection(value: unknown, transcription: true): AISettings['transcription']
function selection(value: unknown, transcription: false): ChatSelection
function selection(value: unknown, transcription: boolean): ChatSelection | AISettings['transcription'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider selection.')
  const item = value as Record<string, unknown>
  if (transcription && item.provider === 'chatgpt') throw new Error('ChatGPT plan usage does not support audio transcription. Choose Gemini or OpenAI for transcription.')
  if (!transcription && item.provider === 'local') throw new Error('Local Whisper is for transcription. Choose a chat provider for summaries and Assistant.')
  const provider = transcription && item.provider === 'local' ? 'local' : !transcription && item.provider === 'chatgpt' ? 'chatgpt' : providerId(item.provider)
  if (typeof item.model !== 'string' || !/^[a-zA-Z0-9._:-]{1,120}$/.test(item.model)) throw new Error('Choose a valid model.')
  if (transcription && !(provider === 'local' ? LOCAL_TRANSCRIPTION_MODELS : DEFAULT_MODELS[provider as ProviderId]).some(m => m.id === item.model && m.transcription)) throw new Error('Choose a model with documented audio timestamps.')
  return { provider, model: item.model }
}
export function validateAISettings(value: unknown, current: AISettings = structuredClone(DEFAULT_AI_SETTINGS)): AISettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid AI settings.')
  const patch = value as Record<string, unknown>
  const result = { ...current }
  for (const [key, field] of Object.entries(patch)) {
    switch (key) {
      case 'transcription': result.transcription = selection(field, true); break
      case 'chat': result.chat = selection(field, false); break
      case 'autoTranscribe': if (typeof field !== 'boolean') throw new Error('Invalid automatic transcription setting.'); result.autoTranscribe = field; break
      case 'language': if (typeof field !== 'string' || (field !== 'auto' && !/^[a-z]{2,3}(-[a-zA-Z]{2,8})?$/.test(field))) throw new Error('Use auto or a language code, such as en or en-US.'); result.language = field; break
      case 'summaryTemplate': if (!['meeting', 'call', 'interview', 'dictation', 'custom'].includes(String(field))) throw new Error('Invalid summary template.'); result.summaryTemplate = field as AISettings['summaryTemplate']; break
      case 'customPrompt': if (typeof field !== 'string' || field.length > 4000) throw new Error('Keep the custom summary prompt under 4,000 characters.'); result.customPrompt = field; break
      case 'suggestThreshold': case 'autoAssignThreshold': if (typeof field !== 'number' || !Number.isFinite(field) || field < 0 || field > 1) throw new Error('Voice thresholds must be between 0 and 1.'); result[key] = field; break
      default: throw new Error('Unknown AI setting.')
    }
  }
  if (result.suggestThreshold >= result.autoAssignThreshold) throw new Error('The suggestion threshold must be lower than the automatic assignment threshold.')
  return result
}
export function readAISettings(): AISettings {
  const row = queryOne<{ value: string }>("SELECT value FROM settings WHERE key='ai'")
  return row ? validateAISettings(JSON.parse(row.value)) : structuredClone(DEFAULT_AI_SETTINGS)
}
export function updateAISettings(patch: unknown): AISettings {
  const settings = validateAISettings(patch, readAISettings())
  run("INSERT OR REPLACE INTO settings(key, value) VALUES ('ai', ?)", [JSON.stringify(settings)])
  return settings
}
