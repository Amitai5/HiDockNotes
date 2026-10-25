// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { appClient, setAppClient } from '../../services/app-client'
import { LibraryPage } from '../LibraryPage'
import { LibrarySidebar } from '../../components/LibrarySidebar'
import { LibraryNavigationProvider } from '../../hooks/useLibraryNavigation'
import { useAppStore } from '../../store/useAppStore'
import type { AppClient, RecordingView } from '../../shared/contracts'
import type { LibraryContentOptions, LibraryContentRow } from '../../shared/library'
import { NOTE_DRAG_TYPE, RECORDING_DRAG_TYPE } from '../../hooks/useRecordingDrop'
import { EMPTY_REFERENCE_CONTEXT } from '../../shared/reference-context'

vi.mock('../../components/ProcessingQueue', () => ({ ProcessingQueue: () => null }))
vi.mock('../../hooks/useSemanticSearch', () => ({ useSemanticSearch: () => ({ enabled: false, modelReady: false }) }))
vi.mock('../../components/NoteEditor', () => ({ default: ({ note }: { note: { id: string } }) => <p data-testid="selected-note">{note.id}</p>, HistoricalNote: () => null }))
let rows: LibraryContentRow[], changed: (() => void)[]
const create = vi.fn(), content = vi.fn()
const projects = [{ id: 'team', name: 'Team', count: 1, noteCount: 1, itemCount: 2 }, { id: 'empty', name: 'Empty project', count: 0, noteCount: 0, itemCount: 0 }]
beforeEach(() => {
  changed = []; useAppStore.setState({ search: '', error: null })
  const recording = { id: 'call', title: 'Project call', filename: 'call.hda', recordedAt: '2026-10-07T10:00:00Z', duration: 82, size: 100, status: 'done', verified: true, hasAudio: true, projectId: 'team', summary: 'Recorded budget decision' } as RecordingView
  rows = [{ kind: 'recording', id: 'call', projectId: 'team', projectName: 'Team', title: recording.title, createdAt: recording.recordedAt, updatedAt: recording.recordedAt, preview: recording.summary!, recording }, { kind: 'note', id: 'written', title: 'Prepared brief', projectId: 'team', projectName: 'Team', revision: 4, createdAt: '2026-10-22T10:00:00Z', updatedAt: '2026-10-23T10:00:00Z', preview: 'Research for next week', tags: [] }, { kind: 'note', id: 'loose-note', title: 'Unfiled idea', projectId: null, projectName: null, revision: 1, createdAt: '2026-10-23T11:00:00Z', updatedAt: '2026-10-23T11:00:00Z', preview: 'A written thought', tags: [] }]
  content.mockReset().mockImplementation(async (options: LibraryContentOptions) => { const items = rows.filter(row => (!options.scope || options.scope.kind === 'all' || options.scope.kind === 'project' && row.projectId === options.scope.projectId || options.scope.kind === 'unfiled' && !row.projectId) && (!options.kind || options.kind === 'all' || row.kind === options.kind) && (!options.query || `${row.title} ${row.preview}`.toLowerCase().includes(options.query.toLowerCase())) && (row.kind === 'note' || (!options.status || row.recording.status === options.status) && (!options.from || row.recording.recordedAt >= options.from))); return { items, total: items.length, nextCursor: null } })
  create.mockReset().mockResolvedValue({ id: 'new', name: 'Research', count: 0 })
  setAppClient({ notes: { create: vi.fn(async () => ({ id: 'new-note', projectId: 'team' })), move: vi.fn(async () => ({ status: 'saved' })) }, library: { content, onChanged: (callback: () => void) => { changed.push(callback); return () => { changed = changed.filter(value => value !== callback) } }, navigation: vi.fn(async () => ({ projects, looseRecordings: [], projectRecordings: { team: [recording] } })) }, projects: { create, assign: vi.fn(async () => undefined) }, referenceContext: { get: vi.fn(async () => ({ content: EMPTY_REFERENCE_CONTEXT, version: 0, updatedAt: null })), save: vi.fn() } } as unknown as AppClient)
})
afterEach(cleanup)
function Location(): JSX.Element { const location = useLocation(); return <p data-testid="route">{location.pathname + location.search}</p> }
function show(path = '/library') { return render(<MemoryRouter initialEntries={[path]}><LibraryNavigationProvider><aside aria-label="Navigation"><LibrarySidebar /></aside><main><Routes><Route path="/library" element={<LibraryPage />} /><Route path="/notes/:noteId" element={<Location />} /><Route path="/library/:id" element={<Location />} /></Routes></main></LibraryNavigationProvider></MemoryRouter>) }
describe('mixed library workspace and flat navigation', () => {
  it('does not redirect a newly selected note into the previous note’s project', async () => {
    const observed: string[] = []
    function Path(): JSX.Element { const location = useLocation(); useEffect(() => { observed.push(location.pathname + location.search) }, [location]); return <Link to="/notes/two?project=empty">Open another project note</Link> }
    appClient.notes.get = vi.fn(async id => ({ kind: 'note', id, projectId: id === 'one' ? 'team' : 'empty', projectName: id === 'one' ? 'Team' : 'Empty project', title: id, revision: 1 } as never))
    render(<MemoryRouter initialEntries={['/notes/one?project=team']}><LibraryNavigationProvider><Path /><Routes><Route path="/notes/:noteId" element={<LibraryPage />} /></Routes></LibraryNavigationProvider></MemoryRouter>)
    expect(await screen.findByTestId('selected-note')).toHaveTextContent('one'); fireEvent.click(screen.getByRole('link', { name: 'Open another project note' })); await waitFor(() => expect(screen.getByTestId('selected-note')).toHaveTextContent('two')); expect(observed).not.toContain('/notes/two?project=team'); expect(observed.at(-1)).toBe('/notes/two?project=empty')
  })
  it('shows a flat Library/Projects/Unfiled navigation with no counts or disclosure controls', async () => {
    show(); const sidebar = within(screen.getByRole('complementary', { name: 'Navigation' })); await sidebar.findByRole('link', { name: 'Team' })
    expect(sidebar.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page'); expect(sidebar.getByRole('link', { name: 'Unfiled items' })).toBeVisible(); expect(sidebar.queryByRole('button', { name: /Expand|Collapse/ })).toBeNull(); expect(sidebar.queryByRole('link', { name: 'Project call' })).toBeNull(); expect(sidebar.queryByText('2')).toBeNull()
  })
  it('includes notes and recordings at the Library root with an item count', async () => {
    show(); expect(await screen.findByRole('link', { name: /Prepared brief/ })).toBeVisible(); expect(screen.getByRole('link', { name: /Project call/ })).toBeVisible(); expect(screen.getByRole('link', { name: /Unfiled idea/ })).toBeVisible(); expect(screen.getByText('3 items')).toBeVisible(); expect(content.mock.calls[0][0]).not.toHaveProperty('from')
  })
  it('scopes project content and keeps the project as the only active sidebar destination', async () => {
    show('/library?project=team'); expect(await screen.findByRole('link', { name: /Prepared brief/ })).toBeVisible(); expect(screen.queryByRole('link', { name: /Unfiled idea/ })).toBeNull(); const sidebar = within(screen.getByRole('complementary', { name: 'Navigation' })); expect(await sidebar.findByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page'); expect(sidebar.getByRole('link', { name: 'Library' })).not.toHaveAttribute('aria-current')
  })
  it('keeps recording status and date filters from hiding written notes in All', async () => {
    show('/library?project=team'); await screen.findByRole('link', { name: /Project call/ }); fireEvent.click(screen.getByText('Recording filters')); fireEvent.change(screen.getByLabelText('Filter by recording status'), { target: { value: 'failed' } }); fireEvent.change(screen.getByLabelText('Recordings from date'), { target: { value: '2026-10-23' } }); await waitFor(() => expect(screen.queryByRole('link', { name: /Project call/ })).toBeNull()); expect(screen.getByRole('link', { name: /Prepared brief/ })).toBeVisible()
  })
  it('offers All/Notes/Recordings without mixing body payloads into list requests', async () => {
    show(); await screen.findByRole('link', { name: /Prepared brief/ }); fireEvent.click(screen.getByRole('button', { name: 'Notes', exact: true })); await waitFor(() => expect(screen.queryByRole('link', { name: /Project call/ })).toBeNull()); expect(content).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'note', limit: 40 })); fireEvent.click(screen.getByRole('button', { name: 'Recordings', exact: true })); expect(await screen.findByRole('link', { name: /Project call/ })).toBeVisible(); expect(screen.queryByRole('link', { name: /Prepared brief/ })).toBeNull()
  })
  it('opens global note search results in their actual project context', async () => {
    useAppStore.setState({ search: 'Research' }); show(); const link = await screen.findByRole('link', { name: /Prepared brief/ }); expect(link).toHaveAttribute('href', '/notes/written?project=team'); fireEvent.click(link); expect(screen.getByTestId('route')).toHaveTextContent('/notes/written?project=team')
  })
  it('shows the three project actions in order and creates an idempotent note in that project', async () => {
    const { container } = show('/library?project=team'); await screen.findByRole('heading', { name: 'Team', level: 1 }); const actions = within(container.querySelector('.project-workspace-actions') as HTMLElement).getAllByRole('button'); expect(actions.map(button => button.textContent)).toEqual(['Project context', 'New note from audio', 'New note']); fireEvent.click(actions[2]); await waitFor(() => expect(appClient.notes.create).toHaveBeenCalledWith({ requestId: expect.any(String), projectId: 'team' })); expect(await screen.findByTestId('route')).toHaveTextContent('/notes/new-note?project=team&focusTitle=1')
  })
  it('reuses a creation request after a lost response rather than duplicating the note', async () => {
    vi.mocked(appClient.notes.create).mockRejectedValueOnce(Error('Connection lost')); show('/library?project=team'); fireEvent.click(screen.getAllByRole('button', { name: 'New note' })[0]); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry new note' })); await screen.findByTestId('route'); expect(vi.mocked(appClient.notes.create).mock.calls[0][0]).toEqual(vi.mocked(appClient.notes.create).mock.calls[1][0])
  })
  it('moves typed note and recording drags through their separate contracts', async () => {
    show(); const target = await within(screen.getByRole('complementary', { name: 'Navigation' })).findByRole('link', { name: 'Team' }); fireEvent.drop(target, { dataTransfer: { types: [NOTE_DRAG_TYPE], getData: () => JSON.stringify({ kind: 'note', id: 'loose-note', revision: 1 }) } }); await waitFor(() => expect(appClient.notes.move).toHaveBeenCalledWith('loose-note', 'team', 1, expect.any(String))); expect(appClient.projects.assign).not.toHaveBeenCalled(); fireEvent.drop(target, { dataTransfer: { types: [RECORDING_DRAG_TYPE], getData: () => 'loose-recording' } }); await waitFor(() => expect(appClient.projects.assign).toHaveBeenCalledWith('loose-recording', 'team'))
  })
  it('rejects malformed note drags and exposes a conflict without assigning a recording', async () => {
    show(); const target = await within(screen.getByRole('complementary', { name: 'Navigation' })).findByRole('link', { name: 'Team' }); fireEvent.drop(target, { dataTransfer: { types: [NOTE_DRAG_TYPE], getData: () => 'not json' } }); expect(appClient.notes.move).not.toHaveBeenCalled(); vi.mocked(appClient.notes.move).mockResolvedValueOnce({ status: 'conflict', current: {} } as never); fireEvent.drop(target, { dataTransfer: { types: [NOTE_DRAG_TYPE], getData: () => JSON.stringify({ kind: 'note', id: 'written', revision: 3 }) } }); await waitFor(() => expect(useAppStore.getState().error).toContain('changed')); expect(appClient.projects.assign).not.toHaveBeenCalled()
  })
  it('makes Unfiled include notes and refreshes metadata after a saved change', async () => {
    show('/library?scope=unfiled'); const note = await screen.findByRole('link', { name: /Unfiled idea/ }); expect(screen.queryByRole('link', { name: /Prepared brief/ })).toBeNull(); rows[2] = { ...rows[2], title: 'Updated idea' }; act(() => changed.forEach(callback => callback())); await waitFor(() => expect(note).toHaveTextContent('Updated idea'))
  })
  it('keeps project-folder creation in the Projects sidebar control', async () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'New project folder' })); expect(screen.getByLabelText('Folder name')).toHaveFocus(); fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: ' Research ' } }); fireEvent.click(screen.getByRole('button', { name: 'Create folder' })); await waitFor(() => expect(create).toHaveBeenCalledWith('Research')); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
