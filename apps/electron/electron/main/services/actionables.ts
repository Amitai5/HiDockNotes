import type { ActionablePatch } from '../../../src/shared/actionables'
import { isDateOnly } from '../../../src/shared/actionables'
import { queryOne, run, runInTransaction } from './database'

export function updateActionable(id: string, value: unknown, now = new Date()): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid action item.')
  const input = value as Record<string, unknown>
  if (!Object.keys(input).length || Object.keys(input).some(key => !['text', 'done', 'dueDate'].includes(key))) throw new Error('Invalid action item field.')
  const patch: ActionablePatch = {}
  if (input.text !== undefined) {
    if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 2000) throw new Error('Give the action item a name between 1 and 2000 characters.')
    patch.text = input.text.trim()
  }
  if (input.done !== undefined) { if (typeof input.done !== 'boolean') throw new Error('Expected a boolean.'); patch.done = input.done }
  if (input.dueDate !== undefined) { if (input.dueDate !== null && !isDateOnly(input.dueDate)) throw new Error('Choose a valid due date.'); patch.dueDate = input.dueDate as string | null }
  runInTransaction(() => {
    if (!queryOne('SELECT id FROM actionables WHERE id=?', [id])) throw new Error('Action item was not found.')
    if (patch.done !== undefined) run('UPDATE actionables SET completed_at=CASE WHEN ?=0 THEN NULL WHEN done=0 THEN ? ELSE completed_at END, done=? WHERE id=?', [Number(patch.done), now.toISOString(), Number(patch.done), id])
    if (patch.text !== undefined) run('UPDATE actionables SET text=? WHERE id=?', [patch.text, id])
    if (patch.dueDate !== undefined) run('UPDATE actionables SET due_date=? WHERE id=?', [patch.dueDate, id])
  })
}
