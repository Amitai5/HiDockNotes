// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom'
import { appClient, setAppClient } from '../../services/app-client'
import type { AppClient } from '../../shared/contracts'
import type { NoteDocument, NoteSave, WrittenNote } from '../../shared/notes'
import NoteEditor from '../NoteEditor'
import { emptyNoteDocument } from '../../shared/note-document'
import * as recovery from '../../services/note-drafts'

vi.mock('../../services/note-drafts', () => { const read = vi.fn(async () => null), write = vi.fn(async () => undefined), remove = vi.fn(async () => undefined); return { readNoteDraft: read, writeNoteDraft: write, removeNoteDraft: remove, captureNoteDraftStore: () => ({ read, write, remove }) } })
vi.mock('../RichNoteEditor', () => ({ default: ({ document, disabled, onChange, beforeContent }: { document: NoteDocument; disabled: boolean; onChange(document: NoteDocument): void; beforeContent?: ReactNode }) => <>{beforeContent}<textarea aria-label="Note body" value={document.content[0].content?.[0]?.text ?? ''} disabled={disabled} onChange={event => onChange({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'block-1' }, content: [{ type: 'text', text: event.target.value }] }] })} /></> }))
let current: WrittenNote, change: (event: { id: string; deleted?: boolean }) => void
beforeEach(() => {
  current = { kind: 'note', id: 'note-1', title: 'Prepared brief', projectId: null, projectName: null, revision: 1, createdAt: '2026-10-23T12:00:00Z', updatedAt: '2026-10-23T12:00:00Z', preview: '', tags: [], document: emptyNoteDocument('block-1'), documentSchema: 1, plainText: '' }
  vi.mocked(recovery.readNoteDraft).mockReset().mockResolvedValue(null); vi.mocked(recovery.writeNoteDraft).mockClear(); vi.mocked(recovery.removeNoteDraft).mockClear()
  setAppClient({ notes: { get: vi.fn(async () => structuredClone(current)), save: vi.fn(async (_id: string, input: NoteSave) => { current = { ...current, title: input.title, document: input.document, tags: input.tags, revision: current.revision + 1 }; return { status: 'saved', note: structuredClone(current) } }), onChanged: vi.fn(callback => { change = callback; return () => undefined }), history: vi.fn(async () => [{ revision: 1, title: current.title, createdAt: current.createdAt }]), delete: vi.fn(async () => ({ status: 'deleted' })), create: vi.fn(async () => ({ ...current, id: 'copy' })) }, library: { onChanged: () => () => undefined } } as unknown as AppClient)
})
afterEach(cleanup)
function show() { const router = createMemoryRouter([{ path: '/', element: <><Link to="/other">Other destination</Link><NoteEditor note={current} focus={false} setFocus={() => undefined} focusTitle={false} blockId={null} onNote={() => undefined} /></> }, { path: '/other', element: <h1>Other page</h1> }, { path: '/notes/:noteId', element: <h1>Copy opened</h1> }, { path: '/library', element: <h1>Library</h1> }]); render(<RouterProvider router={router} />); return router }
describe('note editor server save and recovery flows', () => {
  it('keeps edits unsaved until server acknowledgement and guards browser unload', async () => {
    let done!: () => void; const gate = new Promise<void>(resolve => { done = resolve }), original = vi.mocked(appClient.notes.save).getMockImplementation()!
    vi.mocked(appClient.notes.save).mockImplementationOnce(async (...args) => { await gate; return original(...args) }); show(); await screen.findByLabelText('Note body')
    fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Edited brief' } }); fireEvent.keyDown(screen.getByLabelText('Note title'), { key: 's', ctrlKey: true }); await screen.findByText('Saving…')
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true)
    act(done); await screen.findByText('Saved', { exact: true }); expect(current.title).toBe('Edited brief'); const savedUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedUnload); expect(savedUnload.defaultPrevented).toBe(false)
  })
  it('flushes before route navigation and stays when the save fails', async () => {
    vi.mocked(appClient.notes.save).mockRejectedValueOnce(Error('Server storage is full.')); show(); await screen.findByLabelText('Note body'); fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Keep me' } }); fireEvent.click(screen.getByRole('link', { name: 'Other destination' })); expect(await screen.findByRole('alertdialog')).toHaveTextContent('unsaved edits'); expect(screen.queryByText('Other page')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Stay with note' })); expect(screen.getByLabelText('Note title')).toHaveValue('Keep me'); fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await screen.findByText('Saved', { exact: true }); fireEvent.click(screen.getByRole('link', { name: 'Other destination' })); expect(await screen.findByText('Other page')).toBeVisible()
  })
  it('offers recovery without overwriting the server until it is explicitly restored', async () => {
    vi.mocked(recovery.readNoteDraft).mockResolvedValue({ id: current.id, title: 'Recovered private draft', document: current.document, tags: [], baseRevision: 1, updatedAt: current.updatedAt }); show(); await screen.findByText('Recovered unsaved edits from this browser'); expect(screen.getByLabelText('Note title')).toBeDisabled(); expect(appClient.notes.save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Restore draft' })); await screen.findByText('Saved', { exact: true }); expect(screen.getByLabelText('Note title')).toHaveValue('Recovered private draft'); expect(recovery.removeNoteDraft).toHaveBeenCalledWith(current.id)
  })
  it('keeps the losing content visible and lets the user reload the winning revision', async () => {
    const winner = { ...current, revision: 2, title: 'Winning revision' }; vi.mocked(appClient.notes.save).mockResolvedValueOnce({ status: 'conflict', current: winner }); vi.mocked(appClient.notes.get).mockResolvedValue(winner); show(); await screen.findByLabelText('Note body'); fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Losing draft' } }); fireEvent.keyDown(screen.getByLabelText('Note title'), { key: 's', ctrlKey: true }); await screen.findByText('Save conflict · Draft kept'); expect(screen.getByLabelText('Note title')).toHaveValue('Losing draft'); fireEvent.click(screen.getByRole('button', { name: 'Reload saved version' })); await screen.findByText('Saved', { exact: true }); expect(screen.getByLabelText('Note title')).toHaveValue('Winning revision')
  })
  it('clears the recovery copy on an authoritative delete and prevents further edits', async () => {
    show(); await screen.findByLabelText('Note body'); fireEvent.change(screen.getByLabelText('Note title'), { target: { value: 'Draft' } }); await act(async () => change({ id: current.id, deleted: true })); await screen.findByText('Deleted', { exact: true }); expect(recovery.removeNoteDraft).toHaveBeenCalledWith(current.id); expect(screen.getByLabelText('Note title')).toBeDisabled(); expect(screen.getByLabelText('Note body')).toBeDisabled(); expect(appClient.notes.save).not.toHaveBeenCalled()
  })
  it('requires explicit confirmation before deleting a written note', async () => {
    show(); await screen.findByLabelText('Note body'); fireEvent.click(screen.getByLabelText('Note actions')); fireEvent.click(screen.getByRole('button', { name: 'Delete note' })); expect(appClient.notes.delete).not.toHaveBeenCalled(); expect(screen.getByRole('alertdialog')).toHaveTextContent('saved document, tags, recent revisions'); fireEvent.click(screen.getByRole('button', { name: 'Delete note', exact: true })); await waitFor(() => expect(appClient.notes.delete).toHaveBeenCalledWith(current.id, 1, true)); expect(await screen.findByRole('heading', { name: 'Library' })).toBeVisible()
  })
})
