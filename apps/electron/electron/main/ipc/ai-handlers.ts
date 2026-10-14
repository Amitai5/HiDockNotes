import { handle } from './trusted-ipc'
import { validateBoolean, validateId, validateText } from './jensen-validation'
import { providerId, updateAISettings } from '../ai/settings'
import { validateApiKey, type CredentialVault } from '../ai/credentials'
import type { TranscriptionQueue } from '../ai/queue'
import type { ProviderFactory } from '../ai/providers'
import { assignSegment, confirmSpeaker, deleteVoiceProfile, deleteVoiceSample, listVoiceProfiles, mergeVoiceProfiles, nameSpeaker, renameVoiceProfile } from '../ai/voices'
import { RecordingAssistant } from '../ai/assistant'
import type { ChatMessage } from '../../../src/shared/ai'
import type { ChatGPTAuth } from '../ai/chatgpt-auth'
import { CHATGPT_USAGE } from '../ai/chatgpt-protocol'
import { readAISettings } from '../ai/settings'

export function registerAIHandlers(queue: TranscriptionQueue, vault: CredentialVault, providers: ProviderFactory, changed: () => void, chatgpt: ChatGPTAuth, openBrowser: (url: string) => Promise<void>): void {
  const verifying = new Set<string>()
  const assistant = new RecordingAssistant(vault, providers)
  let chatting = false
  handle('assistant:ask', async (question, project, history) => {
    const text = validateText(question, 4000)
    if (!text) throw new Error('Ask a question about your recordings.')
    if (!Array.isArray(history) || history.length > 8) throw new Error('Invalid conversation history.')
    const messages = history.map(message => {
      if (!message || typeof message !== 'object' || !['user', 'assistant'].includes(message.role)) throw new Error('Invalid chat message.')
      return { role: message.role, content: validateText(message.content, 24000) } as ChatMessage
    })
    if (chatting) throw new Error('Wait for the current answer to finish.')
    chatting = true
    try { return await assistant.ask(text, project === null ? null : validateId(project), messages) } finally { chatting = false }
  })
  handle('ai:state', () => queue.state())
  handle('ai:resume-review', confirmed => { queue.resumeReview(validateBoolean(confirmed)); return queue.state() })
  handle('ai:cancel-summaries', () => queue.cancelQueuedSummaries())
  handle('ai:settings', patch => { updateAISettings(patch); queue.enqueuePending(); queue.kick(); changed(); return queue.state() })
  handle('ai:verify', async (value, input) => {
    const provider = providerId(value), key = validateApiKey(provider, input)
    if (verifying.has(provider)) throw new Error('Key verification is already running.')
    verifying.add(provider)
    try {
      const models = await providers(provider, key).listModels()
      vault.saveVerified(provider, key, models)
      queue.enqueuePending(); queue.kick(); changed()
      return queue.state()
    } finally { verifying.delete(provider) }
  })
  handle('ai:models', async value => {
    const provider = providerId(value), key = vault.read(provider)
    if (!key) throw new Error('Verify this provider key first.')
    const models = await providers(provider, key).listModels()
    vault.updateModels(provider, models); queue.kick(); return queue.state()
  })
  handle('ai:remove-key', value => { vault.remove(providerId(value)); changed(); return queue.state() })
  handle('ai:process', id => queue.enqueue(validateId(id), true))
  handle('ai:reprocess', (id, mode) => {
    if (mode !== 'summarize' && mode !== 'transcribe') throw new Error('Choose resummarize or retranscribe.')
    queue.reprocess(validateId(id), mode)
  })
  handle('ai:process-pending', () => queue.enqueuePending(true))
  handle('chatgpt:sign-in', async id => { await chatgpt.startSignIn(id === null ? null : validateId(id)); return queue.state() })
  handle('chatgpt:cancel-sign-in', () => { chatgpt.cancelSignIn(); return queue.state() })
  handle('chatgpt:select', id => {
    chatgpt.select(validateId(id))
    const models = chatgpt.state().models, selection = readAISettings().chat
    if (selection.provider === 'chatgpt' && !models.some(model => model.id === selection.model)) updateAISettings({ chat: { provider: 'chatgpt', model: models[0].id } })
    queue.kick(); changed(); return queue.state()
  })
  handle('chatgpt:sign-out', async id => { const message = await chatgpt.signOut(validateId(id)); return { state: queue.state(), message } })
  handle('chatgpt:remove', async (id, confirmed) => {
    if (!validateBoolean(confirmed)) throw new Error('Confirm before removing a saved ChatGPT account.')
    const message = await chatgpt.remove(validateId(id))
    const models = chatgpt.state().models, selection = readAISettings().chat
    if (selection.provider === 'chatgpt' && !models.some(model => model.id === selection.model)) updateAISettings({ chat: { provider: 'chatgpt', model: models[0].id } })
    queue.kick(); changed(); return { state: queue.state(), message }
  })
  handle('chatgpt:models', async () => { await chatgpt.refreshModels(); queue.kick(); return queue.state() })
  handle('chatgpt:acknowledge-welcome', () => { chatgpt.acknowledgeWelcome(); return queue.state() })
  handle('chatgpt:manage-usage', () => openBrowser(CHATGPT_USAGE))
  handle('chatgpt:resume', () => { chatgpt.resume(); queue.kick(); return queue.state() })
  handle('voices:list', listVoiceProfiles)
  handle('voices:name-speaker', (id, name) => { nameSpeaker(validateId(id), validateText(name, 80)); changed() })
  handle('voices:assign-segment', (recording, segment, name) => { assignSegment(validateId(recording), validateId(segment), validateText(name, 80)); changed() })
  handle('voices:confirm-speaker', id => { confirmSpeaker(validateId(id)); changed() })
  handle('voices:rename', (id, name) => { renameVoiceProfile(validateId(id), validateText(name, 80)); changed() })
  handle('voices:merge', (source, target) => { mergeVoiceProfiles(validateId(source), validateId(target)); changed() })
  handle('voices:delete', (id, confirmed) => { if (!validateBoolean(confirmed)) throw new Error('Confirm before deleting a voice profile.'); deleteVoiceProfile(validateId(id)); changed() })
  handle('voices:delete-sample', (id, confirmed) => { if (!validateBoolean(confirmed)) throw new Error('Confirm before deleting a voice sample.'); deleteVoiceSample(validateId(id)); changed() })
}
