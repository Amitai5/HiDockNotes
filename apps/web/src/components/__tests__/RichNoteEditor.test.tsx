// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import RichNoteEditor from '../RichNoteEditor'
import type { NoteDocument } from '../../shared/notes'
import { projectNoteBlocks, validateNoteDocument } from '../../shared/note-document'

afterEach(cleanup)
const document: NoteDocument = { type: 'doc', content: [{ type: 'heading', attrs: { id: 'heading', level: 1 }, content: [{ type: 'text', text: 'Preparation' }] }, { type: 'paragraph', attrs: { id: 'paragraph' }, content: [{ type: 'text', text: 'Safe evidence', marks: [{ type: 'bold' }, { type: 'underline' }, { type: 'link', attrs: { href: 'https://example.com/evidence' } }] }] }, { type: 'taskList', content: [{ type: 'taskItem', attrs: { id: 'task', checked: false }, content: [{ type: 'paragraph', attrs: { id: 'task-text' }, content: [{ type: 'text', text: 'Review the brief' }] }, { type: 'bulletList', content: [{ type: 'listItem', attrs: { id: 'nested-item' }, content: [{ type: 'paragraph', attrs: { id: 'nested-paragraph' }, content: [{ type: 'text', text: 'Nested source' }] }] }] }] }] }] }
describe('real Tiptap document integration', () => {
  it('places formatting above the title and writing canvas', async () => {
    render(<RichNoteEditor document={document} disabled={false} onChange={() => undefined} beforeContent={<input aria-label="Note title" defaultValue="Launch checklist" />} />)
    const toolbar = screen.getByRole('toolbar', { name: 'Note formatting' }), title = screen.getByRole('textbox', { name: 'Note title' }), body = await screen.findByRole('textbox', { name: 'Note body' })
    expect(toolbar.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(title.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('renders supported formatting and emits a server-valid checklist update with stable block identities', async () => {
    const change = vi.fn(), view = render(<RichNoteEditor document={document} disabled={false} onChange={change} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'Preparation' })).toBeVisible()
    expect(view.container.querySelector('strong u a, u strong a, a strong u, a u strong, strong a u, u a strong')).toHaveTextContent('Safe evidence')
    expect(view.container.querySelector('ul[data-type=taskList] ul li')).toHaveTextContent('Nested source')
    fireEvent.click(view.container.querySelector('input[type=checkbox]')!)
    await waitFor(() => expect(change).toHaveBeenCalled())
    const saved = validateNoteDocument(change.mock.calls.at(-1)![0])
    expect(projectNoteBlocks(saved).find(block => block.id === 'task-text')).toMatchObject({ checked: true, text: '[x] Review the brief' })
    expect(saved.content[0].attrs?.id).toBe('heading'); expect(saved.content[1].attrs?.id).toBe('paragraph')
  })
  it('updates displayed content after a canonical reset without announcing a user edit', async () => {
    const change = vi.fn(), view = render(<RichNoteEditor document={document} disabled={false} onChange={change} />)
    await screen.findByRole('heading', { name: 'Preparation' })
    const newer: NoteDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'replacement' }, content: [{ type: 'text', text: 'Saved in another window' }] }] }
    view.rerender(<RichNoteEditor document={newer} disabled={false} onChange={change} />)
    expect(await screen.findByText('Saved in another window')).toBeVisible(); expect(screen.queryByRole('heading', { name: 'Preparation' })).toBeNull(); expect(change).not.toHaveBeenCalled()
  })
})
