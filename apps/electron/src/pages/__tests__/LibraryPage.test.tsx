// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { LibraryPage } from '../LibraryPage'
import { LibrarySidebar } from '../../components/LibrarySidebar'
import { LibraryNavigationProvider } from '../../hooks/useLibraryNavigation'
import { useAppStore } from '../../store/useAppStore'
import type { ElectronAPI, RecordingView } from '../../shared/contracts'
import { RECORDING_DRAG_TYPE } from '../../hooks/useRecordingDrop'
import { EMPTY_REFERENCE_CONTEXT } from '../../shared/reference-context'

vi.mock('../../components/ProcessingQueue', () => ({ ProcessingQueue: () => null }))
const create = vi.fn()
let changed: (() => void)[], recordings: RecordingView[]
beforeEach(() => {
  changed = []
  recordings = [
    { id: 'filed', filename: 'filed.hda', title: 'Project call', recordedAt: '2026-10-07T10:00:00Z', duration: 10, size: 100, status: 'done', verified: true, hasAudio: true, projectId: 'team', summary: 'Budget' },
    { id: 'loose', filename: 'loose.hda', title: 'Quick thought', recordedAt: '2026-10-07T11:00:00Z', duration: 10, size: 100, status: 'downloaded', verified: true, hasAudio: true, projectId: null, summary: null }
  ]
  useAppStore.setState({ search: '', error: null })
  create.mockReset().mockResolvedValue({ id: 'new', name: 'Research', count: 0 })
  window.electronAPI = { library: { list: vi.fn(async () => recordings), navigation: vi.fn(async () => ({ projects: [{ id: 'team', name: 'Team', count: 1 }, { id: 'empty', name: 'Empty project', count: 0 }], looseRecordings: recordings.filter(value => !value.projectId), projectRecordings: { team: recordings.filter(value => value.projectId === 'team') } })), onChanged: vi.fn(callback => { changed.push(callback); return vi.fn() }) }, projects: { create, assign: vi.fn(async () => undefined) } } as unknown as ElectronAPI
})
afterEach(cleanup)
function show(path = '/library') { return render(<MemoryRouter initialEntries={[path]}><LibraryNavigationProvider><aside aria-label="Library navigation"><LibrarySidebar /></aside><main><LibraryPage /></main></LibraryNavigationProvider></MemoryRouter>) }
describe('project folders inside Library', () => {
  it('opens a context editor for the selected project without showing loose recordings', async () => {
    window.electronAPI.referenceContext = { get: vi.fn(async () => ({ content: { ...EMPTY_REFERENCE_CONTEXT, background: 'Project background' }, version: 1, updatedAt: '2026-10-20T12:00:00Z' })), save: vi.fn() }
    show('/library?project=team')
    await screen.findByRole('heading', { name: 'Team', level: 1 }, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Project context' }))
    expect(await screen.findByDisplayValue('Project background')).toBeVisible()
    expect(window.electronAPI.referenceContext.get).toHaveBeenCalledWith('team')
    expect(screen.getByRole('heading', { name: 'Team context' })).toBeVisible()
    expect(screen.queryByRole('link', { name: /Quick thought/ })).toBeNull()
  })
  it('shows every project folder above loose recordings, with matching sidebar links', async () => {
    show()
    const page = within(screen.getByRole('main'))
    await page.findByRole('link', { name: /Team 1 recording/ })
    expect(page.getByRole('link', { name: /Empty project 0 recordings/ })).toHaveAttribute('href', '/library?project=empty')
    expect(page.getByRole('link', { name: /Quick thought/ })).toBeVisible()
    expect(page.queryByRole('link', { name: /Project call/ })).toBeNull()
    const sidebar = within(screen.getByRole('complementary'))
    expect(sidebar.queryByRole('link', { name: /Team/ })).toBeNull()
    fireEvent.click(sidebar.getByRole('button', { name: 'Expand library folders' }))
    expect(sidebar.getByRole('link', { name: /Team/ })).toHaveAttribute('href', '/library?project=team')
    fireEvent.click(sidebar.getByRole('button', { name: 'Expand Unfiled recordings' }))
    expect(sidebar.getByRole('link', { name: 'Quick thought' })).toHaveAttribute('href', '/library/loose')
    expect(sidebar.queryByRole('link', { name: 'Projects' })).toBeNull()
  })
  it('opens a project folder and lets the user return to the Library root', async () => {
    show()
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /Team 1 recording/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeVisible()
    expect(within(screen.getByRole('main')).getByRole('link', { name: /Project call/ })).toBeVisible()
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /Quick thought/ })).toBeNull()
    expect(within(screen.getByRole('main')).queryByRole('region', { name: 'Project folders' })).toBeNull()
    expect(within(screen.getByRole('main')).queryByText('Unfiled recordings')).toBeNull()
    expect(screen.queryByText('Move between folders')).toBeNull()
    fireEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Library' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  })
  it('keeps global search able to find recordings inside folders', async () => {
    useAppStore.setState({ search: 'Budget' })
    show()
    expect(await within(screen.getByRole('main')).findByRole('link', { name: /Project call/ })).toBeVisible()
    expect(within(screen.getByRole('main')).getByRole('region', { name: 'Project folders' })).toBeVisible()
    expect(screen.getByText('Across all folders and unfiled recordings')).toBeVisible()
  })
  it('creates project folders from Library and leaves errors visible', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: ' Research ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith('Research'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    create.mockRejectedValueOnce(new Error('A folder with this name already exists.'))
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    fireEvent.change(screen.getByLabelText('Folder name'), { target: { value: 'Research' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })
  it('updates sidebar membership when project assignment or a recording title changes', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Expand library folders' }))
    await screen.findByRole('button', { name: 'Expand Unfiled recordings' })
    fireEvent.click(screen.getByRole('button', { name: 'Expand Unfiled recordings' }))
    await within(screen.getByRole('complementary')).findByRole('link', { name: 'Quick thought' })
    recordings[1] = { ...recordings[1], projectId: 'team' }
    changed.forEach(callback => callback())
    await waitFor(() => expect(within(screen.getByRole('complementary')).queryByRole('link', { name: 'Quick thought' })).toBeNull())
  })
  it('expands and collapses individual project folders', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'Expand library folders' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Expand Team' }))
    expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Project call' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Team' }))
    expect(within(screen.getByRole('complementary')).queryByRole('link', { name: 'Project call' })).toBeNull()
  })
  it('moves internal recording drops into folders and ignores external files', async () => {
    show()
    const target = await within(screen.getByRole('main')).findByRole('link', { name: /Team 1 recording/ })
    const transfer = { types: [RECORDING_DRAG_TYPE], getData: () => 'loose', dropEffect: '' }
    fireEvent.dragEnter(target, { dataTransfer: transfer })
    expect(target).toHaveClass('recording-drop-over')
    fireEvent.drop(target, { dataTransfer: transfer })
    await waitFor(() => expect(window.electronAPI.projects.assign).toHaveBeenCalledWith('loose', 'team'))
    fireEvent.drop(target, { dataTransfer: { types: ['Files'], getData: () => '/private/file.wav' } })
    expect(window.electronAPI.projects.assign).toHaveBeenCalledTimes(1)
  })
  it('keeps a failed move visible and leaves the recording in its original list', async () => {
    vi.mocked(window.electronAPI.projects.assign).mockRejectedValueOnce(new Error('The folder no longer exists.'))
    show()
    const target = await within(screen.getByRole('main')).findByRole('link', { name: /Team 1 recording/ })
    fireEvent.drop(target, { dataTransfer: { types: [RECORDING_DRAG_TYPE], getData: () => 'loose' } })
    await waitFor(() => expect(useAppStore.getState().error).toBe('The folder no longer exists.'))
    expect(within(screen.getByRole('main')).getByRole('link', { name: /Quick thought/ })).toBeVisible()
  })
  it('keeps project filters scoped to that project and removes all folder destination cards', async () => {
    recordings.push({ ...recordings[0], id: 'other', projectId: 'empty', title: 'Another project call' })
    show('/library?project=team')
    await screen.findByRole('heading', { level: 1, name: 'Team' })
    fireEvent.change(screen.getByLabelText('Recordings from date'), { target: { value: '2026-10-07' } })
    const page = within(screen.getByRole('main'))
    expect(await page.findByRole('link', { name: /Project call/ })).toBeVisible()
    expect(page.queryByRole('region', { name: 'Project folders' })).toBeNull()
    expect(page.queryByRole('link', { name: /Another project call|Quick thought/ })).toBeNull()
    expect(page.queryByText('Move between folders')).toBeNull()
  })
  it('shows an empty project without falling back to loose recordings or other projects', async () => {
    show('/library?project=empty')
    const page = within(screen.getByRole('main'))
    expect(await page.findByText('This folder is ready')).toBeVisible()
    expect(page.queryByRole('link', { name: /Project call|Quick thought/ })).toBeNull()
    expect(page.queryByText('Unfiled recordings')).toBeNull()
  })
  it('makes Unfiled a distinct sidebar destination and accepts drops there from a project', async () => {
    show('/library?project=team')
    fireEvent.click(screen.getByRole('button', { name: 'Expand library folders' }))
    const unfiled = await within(screen.getByRole('complementary')).findByRole('link', { name: /Unfiled recordings/ })
    expect(unfiled.closest('.library-unfiled-folder')).not.toBeNull()
    fireEvent.drop(unfiled, { dataTransfer: { types: [RECORDING_DRAG_TYPE], getData: () => 'filed' } })
    await waitFor(() => expect(window.electronAPI.projects.assign).toHaveBeenCalledWith('filed', null))
  })
  it('focuses the new folder name field and closes the centered dialog on Escape', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveClass('confirmation-dialog', 'folder-dialog')
    expect(screen.getByLabelText('Folder name')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Create folder' })).toBeDisabled()
    expect(dialog).toHaveTextContent('Add recordings by dragging them onto the folder.')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: 'New folder' })).toHaveFocus())
  })
})
