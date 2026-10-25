import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoteSession } from '../note-session'
import type { NoteDraft } from '../note-drafts'
import type { NoteSave, NotesClient, WrittenNote } from '../../shared/notes'
import { emptyNoteDocument } from '../../shared/note-document'

const initial = (): WrittenNote => ({ kind: 'note', id: 'note-1', title: 'Research', projectId: null, projectName: null, revision: 1, createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z', preview: '', tags: [], document: emptyNoteDocument('block-1'), documentSchema: 1, plainText: '' })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function fixture() {
  let current = initial(), stored: NoteDraft | null = null, id = 0
  const mutations = new Map<string, WrittenNote>()
  const api = {
    get: vi.fn(async () => structuredClone(current)),
    save: vi.fn(async (_id: string, input: NoteSave) => {
      const accepted = mutations.get(input.mutationId)
      if (accepted) return { status: 'saved' as const, note: structuredClone(accepted) }
      if (input.expectedRevision !== current.revision) return { status: 'conflict' as const, current: structuredClone(current) }
      current = { ...current, title: input.title, document: input.document, tags: input.tags, revision: current.revision + 1 }; mutations.set(input.mutationId, structuredClone(current))
      return { status: 'saved' as const, note: structuredClone(current) }
    }),
    create: vi.fn(async () => ({ ...current, id: 'copy' }))
  }
  const store = { read: vi.fn(async () => structuredClone(stored)), write: vi.fn(async (value: NoteDraft) => { stored = structuredClone(value) }), remove: vi.fn(async () => { stored = null }) }
  const make = (note = current) => new NoteSession(structuredClone(note), api as unknown as NotesClient, store, () => `mutation-${++id}`)
  return { api, store, make, stored: () => stored, current: () => current, setCurrent: (note: WrittenNote) => { current = note } }
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-23T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
describe('written-note save sessions', () => {
  it('coalesces typing until the debounce and shows Saved only after acknowledgement', async () => {
    const f = fixture(), session = f.make(), gate = deferred<void>(), save = f.api.save.getMockImplementation()!
    f.api.save.mockImplementation(async (...args) => { await gate.promise; return save(...args) })
    session.edit({ title: 'First' }); session.edit({ title: 'Second' }); expect(session.getSnapshot().status).toBe('unsaved')
    await vi.advanceTimersByTimeAsync(699); expect(f.api.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(f.api.save).toHaveBeenCalledOnce(); expect(session.getSnapshot().status).toBe('saving'); expect(session.dirty).toBe(true)
    gate.resolve(); await session.flush(); expect(session.getSnapshot().status).toBe('saved'); expect(f.current().title).toBe('Second'); expect(f.stored()).toBeNull()
  })
  it('runs one request at a time and saves newer typing against the accepted revision', async () => {
    const f = fixture(), session = f.make(), gate = deferred<void>(), save = f.api.save.getMockImplementation()!
    f.api.save.mockImplementationOnce(async (...args) => { await gate.promise; return save(...args) })
    session.edit({ title: 'A' }); const task = session.flush(); await Promise.resolve(); await Promise.resolve(); session.edit({ title: 'B' }); expect(f.api.save.mock.calls.length).toBeLessThanOrEqual(1)
    gate.resolve(); await task
    expect(f.api.save).toHaveBeenCalledTimes(2); expect(f.api.save.mock.calls[1][1]).toMatchObject({ title: 'B', expectedRevision: 2 }); expect(session.getSnapshot().status).toBe('saved')
  })
  it('retries the identical mutation after a lost response, then saves newer edits', async () => {
    const f = fixture(), session = f.make(), save = f.api.save.getMockImplementation()!
    f.api.save.mockImplementationOnce(async (...args) => { await save(...args); throw Error('Connection lost after commit') })
    session.edit({ title: 'Committed' }); expect(await session.flush()).toBe(false); const attempt = f.api.save.mock.calls[0][1]
    expect(f.current().revision).toBe(2); expect(f.stored()?.attempt).toEqual(attempt)
    session.edit({ title: 'Newer draft' }); expect(await session.flush()).toBe(true)
    expect(f.api.save.mock.calls[1][1]).toEqual(attempt); expect(f.api.save.mock.calls[2][1]).toMatchObject({ expectedRevision: 2, title: 'Newer draft' }); expect(f.current().revision).toBe(3)
  })
  it('keeps a losing tab draft without overwriting the winning save', async () => {
    const f = fixture(), first = f.make(), second = f.make()
    first.edit({ title: 'Winner' }); await first.flush(); second.edit({ title: 'Keep my edits' }); expect(await second.flush()).toBe(false)
    expect(second.getSnapshot()).toMatchObject({ status: 'conflict', draft: { title: 'Keep my edits' }, conflict: { title: 'Winner', revision: 2 } }); expect(f.current().title).toBe('Winner'); expect(f.stored()?.title).toBe('Keep my edits')
    await second.reload(); expect(second.getSnapshot().status).toBe('saved'); expect(second.getSnapshot().draft.title).toBe('Winner'); expect(f.stored()).toBeNull()
  })
  it('restores an offline draft and resolves a lost acknowledgement idempotently after reopening', async () => {
    const f = fixture(), first = f.make(), save = f.api.save.getMockImplementation()!
    f.api.save.mockImplementationOnce(async (...args) => { await save(...args); throw Error('Lost response') })
    first.edit({ title: 'Recovered' }); await first.flush(); first.close(); const reopened = f.make(); await reopened.loadRecovery()
    expect(reopened.getSnapshot().recovery?.attempt).toBeDefined(); await reopened.recover(); expect(f.current().revision).toBe(2); expect(reopened.getSnapshot().status).toBe('saved'); expect(f.stored()).toBeNull()
  })
  it('detects an offline draft based on an older revision without issuing a stale write', async () => {
    const f = fixture(), first = f.make(); first.edit({ title: 'Offline' }); first.close(); await Promise.resolve(); await Promise.resolve()
    f.setCurrent({ ...f.current(), revision: 2, title: 'Other tab' }); const reopened = f.make(); await reopened.loadRecovery(); await reopened.recover()
    expect(reopened.getSnapshot().status).toBe('conflict'); expect(f.api.save).not.toHaveBeenCalled(); expect(reopened.getSnapshot().draft.title).toBe('Offline')
  })
  it('retains a rejected server-full draft and exposes a retry', async () => {
    const f = fixture(), session = f.make(); f.api.save.mockRejectedValueOnce(Error('Server storage is full.'))
    session.edit({ title: 'Do not lose this' }); expect(await session.flush()).toBe(false); expect(session.getSnapshot()).toMatchObject({ status: 'error', error: 'Server storage is full.' }); expect(f.stored()?.title).toBe('Do not lose this')
    expect(await session.flush()).toBe(true); expect(f.current().title).toBe('Do not lose this')
  })
  it('does not resurrect a recovery draft when a pending request completes after deletion', async () => {
    const f = fixture(), session = f.make(), gate = deferred<void>(), save = f.api.save.getMockImplementation()!
    f.api.save.mockImplementationOnce(async (...args) => { await gate.promise; return save(...args) }); session.edit({ title: 'Pending' }); const task = session.flush(); await Promise.resolve(); await Promise.resolve(); await session.deleted(); gate.resolve(); await task
    expect(session.getSnapshot().status).toBe('deleted'); expect(f.stored()).toBeNull(); expect(session.dirty).toBe(false)
  })
  it('ignores a late self change notification until an in-flight save is acknowledged', async () => {
    const f = fixture(), session = f.make(), gate = deferred<void>(), save = f.api.save.getMockImplementation()!
    f.api.save.mockImplementationOnce(async (...args) => { await gate.promise; return save(...args) }); session.edit({ title: 'Own save' }); const task = session.flush(); await session.refresh(); expect(f.api.get).not.toHaveBeenCalled(); gate.resolve(); await task; await Promise.resolve(); expect(session.getSnapshot().status).toBe('saved')
  })
  it('updates project metadata after a project is deleted without discarding a draft', async () => {
    const f = fixture(); f.setCurrent({ ...f.current(), projectId: 'project', projectName: 'Project' }); const session = f.make(); session.edit({ title: 'Still writing' }); f.setCurrent({ ...f.current(), projectId: null, projectName: null }); await session.refresh()
    expect(session.getSnapshot().note.projectId).toBeNull(); expect(session.getSnapshot().draft.title).toBe('Still writing'); expect(session.getSnapshot().status).toBe('unsaved')
  })
  it('warns when recovery storage is unavailable but still permits an acknowledged server save', async () => {
    const f = fixture(), session = f.make(); f.store.write.mockRejectedValue(Error('Browser storage unavailable'))
    session.edit({ title: 'Server is durable' }); await session.flush(); expect(f.current().title).toBe('Server is durable'); expect(session.getSnapshot().status).toBe('saved')
  })
  it('reuses the exact creation request and block identities after a lost duplicate response', async () => {
    const f = fixture(), session = f.make(); f.api.create.mockRejectedValueOnce(Error('Lost copy response')); session.edit({ title: 'Copy this draft' }); await expect(session.copyDraft()).rejects.toThrow('Lost copy response'); session.edit({ title: 'Newer changes stay here' }); await session.copyDraft()
    expect(f.api.create.mock.calls[0]).toEqual(f.api.create.mock.calls[1]); expect(session.getSnapshot().draft.title).toBe('Newer changes stay here'); expect(session.dirty).toBe(true)
  })
})
