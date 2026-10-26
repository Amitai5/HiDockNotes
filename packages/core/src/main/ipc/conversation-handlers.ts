import type { AssistantConversations } from '../services/assistant-conversations'
import { handle } from './trusted-ipc'
import { validateBoolean, validateId, validateText } from './jensen-validation'

function version(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid chat version.'); return Number(value) }
function historyCursor(value: unknown): number | undefined {
  // Older HTTP clients serialized an omitted cursor as null; write versions remain required.
  if (value === undefined || value === null) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Invalid chat history cursor. Reopen this chat and try again.')
  return Number(value)
}
export function registerConversationHandlers(service: AssistantConversations): void {
  handle('conversations:current', () => service.current())
  handle('conversations:select', id => service.select(validateId(id)))
  handle('conversations:list', query => service.list(query === undefined ? '' : validateText(query, 500)))
  handle('conversations:create', project => service.create(project === null ? null : validateId(project)))
  handle('conversations:get', (id, before) => service.get(validateId(id), historyCursor(before)))
  handle('conversations:rename', (id, title, expected) => service.rename(validateId(id), validateText(title, 120), version(expected)))
  handle('conversations:delete', (id, confirmed) => { if (!validateBoolean(confirmed)) throw new Error('Confirm before deleting this chat.'); service.remove(validateId(id)) })
  handle('conversations:send', (id, text, expected) => service.send(validateId(id), validateText(text, 4000), version(expected)))
  handle('conversations:cancel', id => service.cancel(validateId(id)))
}
