// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AssistantNoteDialog, { type AnswerNoteSnapshot } from '../AssistantNoteDialog'
import { AssistantAnswer } from '../AssistantAnswer'
import { setAppClient } from '../../services/app-client'
import type { AppClient } from '../../shared/contracts'
import type { NoteCreate, NoteSave, WrittenNote } from '../../shared/notes'
import { notePlainText } from '../../shared/note-document'

const project = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', targetId = '33333333-3333-4333-8333-333333333333', recordingId = '44444444-4444-4444-8444-444444444444'
const projects = [{ id: project, name: 'Pilot', count: 2 }, { id: other, name: 'Research', count: 1 }]
const answer: AnswerNoteSnapshot = { html: '<h2>Answer</h2><p>Keep <strong>formatting</strong> [1].</p>', title: 'Pilot briefing', projectId: project, citations: [{ number: 1, title: 'Launch review', recordingId, start: 12, excerpt: 'Approved the pilot.' }] }
const existing = (): WrittenNote => ({ kind: 'note', id: targetId, title: 'My manual title', projectId: project, projectName: 'Pilot', revision: 4, tags: ['personal'], preview: 'Existing research', documentSchema: 1, plainText: 'Existing research', createdAt: '2026-11-01T18:00:00Z', updatedAt: '2026-11-03T18:00:00Z', document: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'original' }, content: [{ type: 'text', text: 'Existing research' }] }] } })
const api = { list: vi.fn(), get: vi.fn(), create: vi.fn(), save: vi.fn() }, info = vi.fn(), close = vi.fn(), mode = vi.fn()
beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset()); info.mockReset().mockResolvedValue({ origin: 'https://notes.example' }); close.mockReset(); mode.mockReset()
  api.list.mockResolvedValue({ notes: [existing()], total: 1, nextCursor: null, consistency: 'live' }); api.get.mockResolvedValue(existing())
  api.create.mockImplementation(async (input: NoteCreate) => ({ ...existing(), id: '55555555-5555-4555-8555-555555555555', title: input.title, document: input.document, projectId: input.projectId, revision: 1 }))
  api.save.mockImplementation(async (_id: string, input: NoteSave) => ({ status: 'saved', note: { ...existing(), title: input.title, document: input.document, revision: input.expectedRevision + 1 } }))
  setAppClient({ app: { info, copyText: vi.fn(async () => undefined) }, notes: api } as unknown as AppClient)
})
afterEach(cleanup)
function show(kind: 'create' | 'append' = 'create') { return render(<MemoryRouter><AssistantNoteDialog mode={kind} answer={answer} projects={projects} onClose={close} onClosed={() => undefined} onMode={mode} /></MemoryRouter>) }
const ready = async (label = 'Save note') => waitFor(() => expect(screen.getByRole('button', { name: label, exact: true })).toBeEnabled())
async function pick() { fireEvent.click(await screen.findByRole('button', { name: /My manual title/ })); await ready('Append answer') }

describe('saving Assistant answers as written notes', () => {
  it('defaults to the conversation project, lets the user choose title/project, and preserves linked formatting', async () => {
    show(); await ready()
    expect(screen.getByLabelText('Saved note project')).toHaveValue(project)
    fireEvent.change(screen.getByLabelText('Saved note title'), { target: { value: 'Saved research' } }); fireEvent.change(screen.getByLabelText('Saved note project'), { target: { value: other } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note', exact: true }))
    await screen.findByText('Your answer and its sources are saved on the server.')
    const request = api.create.mock.calls[0][0] as NoteCreate
    expect(request).toMatchObject({ projectId: other, title: 'Saved research' })
    expect(notePlainText(request.document!)).toContain('Approved the pilot.')
    expect(JSON.stringify(request.document)).toContain('https://notes.example/#/library/' + recordingId + '?t=12')
    expect(JSON.stringify(request.document)).toContain('"type":"bold"')
    expect(screen.getByRole('link', { name: 'Open note' })).toHaveAttribute('href', expect.stringContaining('project=' + other))
    expect(api.save).not.toHaveBeenCalled(); expect(api.list).not.toHaveBeenCalled()
  })
  it('retries a lost create acknowledgement with the identical creation key and content', async () => {
    api.create.mockRejectedValueOnce(Error('Reply lost.'))
    show(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Save note', exact: true }))
    await screen.findByText('Reply lost.'); expect(screen.getByLabelText('Saved note title')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await screen.findByRole('link', { name: 'Open note' })
    expect(api.create.mock.calls[1][0]).toEqual(api.create.mock.calls[0][0])
  })
  it('appends to the selected revision without replacing existing text, title, tags or project', async () => {
    show('append'); expect(screen.getByRole('button', { name: 'Append answer' })).toBeDisabled(); await pick()
    fireEvent.click(screen.getByRole('button', { name: 'Append answer' })); await screen.findByRole('link', { name: 'Open note' })
    const [id, input] = api.save.mock.calls[0] as [string, NoteSave]
    expect(id).toBe(targetId); expect(input).toMatchObject({ title: 'My manual title', tags: ['personal'], expectedRevision: 4 })
    expect(input.document.content[0]).toEqual(existing().document.content[0])
    expect(notePlainText(input.document)).toContain('Existing research'); expect(notePlainText(input.document)).toContain('Keep formatting')
    expect(api.create).not.toHaveBeenCalled()
  })
  it('requires explicit review after a concurrent edit and then appends after the latest version', async () => {
    const updated = existing(); updated.revision = 5; updated.title = 'New manual title'; updated.tags = ['new tag']; updated.document.content[0].content![0].text = 'Changed in another window'
    api.save.mockResolvedValueOnce({ status: 'conflict', current: updated })
    show('append'); await pick(); fireEvent.click(screen.getByRole('button', { name: 'Append answer' }))
    expect(await screen.findByText('This note changed before your answer was appended.')).toBeVisible()
    expect(screen.getByText('Changed in another window')).toBeVisible(); expect(api.save).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Append to latest revision' })); await screen.findByRole('link', { name: 'Open note' })
    const first = api.save.mock.calls[0][1] as NoteSave, second = api.save.mock.calls[1][1] as NoteSave
    expect(second).toMatchObject({ title: updated.title, tags: updated.tags, expectedRevision: 5 })
    expect(notePlainText(second.document)).toContain('Changed in another window'); expect(second.mutationId).not.toBe(first.mutationId)
  })
  it('retries an append once after a lost reply using the same mutation and full document', async () => {
    api.save.mockRejectedValueOnce(Error('Reply lost.'))
    show('append'); await pick(); fireEvent.click(screen.getByRole('button', { name: 'Append answer' }))
    await screen.findByText('Reply lost.'); expect(screen.getByLabelText('Find a note')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' })); await screen.findByRole('link', { name: 'Open note' })
    expect(api.save.mock.calls[1]).toEqual(api.save.mock.calls[0])
    expect(notePlainText(api.save.mock.calls[1][1].document).match(/Keep formatting/g)).toHaveLength(1)
  })
  it('offers paged search and project scopes without automatically selecting or changing a note', async () => {
    const second = { ...existing(), id: '66666666-6666-4666-8666-666666666666', title: 'Another destination' }
    api.list.mockResolvedValueOnce({ notes: [existing()], nextCursor: 'page-two', total: 31, consistency: 'live' }).mockResolvedValueOnce({ notes: [second], nextCursor: null, total: 31, consistency: 'live' })
    show('append'); fireEvent.click(await screen.findByRole('button', { name: 'Load more notes' })); await screen.findByRole('button', { name: /Another destination/ })
    expect(api.list.mock.calls[1][0]).toMatchObject({ cursor: 'page-two', scope: { kind: 'project', projectId: project } })
    expect(screen.getByRole('button', { name: 'Append answer' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Find notes in project'), { target: { value: 'all' } }); fireEvent.change(screen.getByLabelText('Find a note'), { target: { value: 'research' } })
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ scope: { kind: 'all' }, query: 'research', limit: 30 }))
    expect(api.create).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled()
  })
  it('ignores an old destination response after selecting a different note', async () => {
    const otherNote = { ...existing(), id: '77777777-7777-4777-8777-777777777777', title: 'Latest destination' }
    api.list.mockResolvedValue({ notes: [existing(), otherNote], nextCursor: null, total: 2, consistency: 'live' })
    let resolve!: (value: WrittenNote) => void; api.get.mockImplementationOnce(() => new Promise<WrittenNote>(done => { resolve = done })).mockResolvedValueOnce(otherNote)
    show('append'); fireEvent.click(await screen.findByRole('button', { name: /My manual title/ })); fireEvent.click(screen.getByRole('button', { name: /Latest destination/ })); await ready('Append answer')
    await act(async () => resolve(existing())); fireEvent.click(screen.getByRole('button', { name: 'Append answer' })); await screen.findByRole('link', { name: 'Open note' })
    expect(api.save.mock.calls[0][0]).toBe(otherNote.id)
  })
  it('shows actionable setup/list/deleted-target errors without writing anything', async () => {
    info.mockRejectedValueOnce(Error('Server unavailable.')); api.list.mockRejectedValueOnce(Error('List unavailable.'))
    show('append'); await screen.findByText('Server unavailable.'); await screen.findByText('List unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry preparing answer' })); fireEvent.click(screen.getByRole('button', { name: 'Retry note list' }))
    api.get.mockRejectedValueOnce(Error('Written note was not found.'))
    fireEvent.click(await screen.findByRole('button', { name: /My manual title/ })); await screen.findByText('Written note was not found.')
    expect(screen.getByRole('button', { name: 'Append answer' })).toBeDisabled(); expect(api.save).not.toHaveBeenCalled()
  })
  it('does not allow duplicate submissions while a save is in flight', async () => {
    let resolve!: (value: WrittenNote) => void; api.create.mockImplementationOnce(() => new Promise<WrittenNote>(done => { resolve = done }))
    show(); await ready(); const button = screen.getByRole('button', { name: 'Save note', exact: true }); fireEvent.click(button); fireEvent.click(button)
    expect(api.create).toHaveBeenCalledTimes(1); expect(screen.getByRole('button', { name: 'Close save answer' })).toBeDisabled()
    await act(async () => resolve(existing())); await screen.findByRole('link', { name: 'Open note' })
  })
  it('adds both actions beside Copy and keeps the answer and composer draft after saving', async () => {
    render(<MemoryRouter><div><AssistantAnswer message={{ id: 'answer', role: 'assistant', content: '**Keep formatting** [1].', citations: answer.citations, ordinal: 1, createdAt: '2026-11-03T18:00:00Z' }} title={answer.title} projectId={project} projects={projects} activeSource={null} onSource={() => undefined} /><textarea aria-label="Question draft" defaultValue="My next question" /></div></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeVisible(); expect(screen.getByRole('button', { name: 'Append to note' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save as note' })); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Save note', exact: true })); await screen.findByRole('link', { name: 'Open note' })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByLabelText('Question draft')).toHaveValue('My next question'); expect(screen.getByText('Keep formatting').tagName).toBe('STRONG')
    expect(screen.getByRole('button', { name: 'Save as note' })).toHaveFocus()
  })
})
