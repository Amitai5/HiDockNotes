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
  window.electronAPI = { library: { list: vi.fn(async () => recordings), navigation: vi.fn(async () => ({ projects: [{ id: 'team', name: 'Team', count: 1 }, { id: 'empty', name: 'Empty project', count: 0 }], looseRecordings: recordings.filter(value => !value.projectId) })), onChanged: vi.fn(callback => { changed.push(callback); return vi.fn() }) }, projects: { create } } as unknown as ElectronAPI
})
afterEach(cleanup)
function show(path = '/library') { return render(<MemoryRouter initialEntries={[path]}><LibraryNavigationProvider><aside aria-label="Library navigation"><LibrarySidebar /></aside><main><LibraryPage /></main></LibraryNavigationProvider></MemoryRouter>) }
describe('project folders inside Library', () => {
  it('shows every project folder above loose recordings, with matching sidebar links', async () => {
    show()
    const page = within(screen.getByRole('main'))
    await page.findByRole('link', { name: /Team 1 recording/ })
    expect(page.getByRole('link', { name: /Empty project 0 recordings/ })).toHaveAttribute('href', '/library?project=empty')
    expect(page.getByRole('link', { name: /Quick thought/ })).toBeVisible()
    expect(page.queryByRole('link', { name: /Project call/ })).toBeNull()
    const sidebar = within(screen.getByRole('complementary'))
    expect(sidebar.getByRole('link', { name: /Team/ })).toHaveAttribute('href', '/library?project=team')
    expect(sidebar.getByRole('link', { name: 'Quick thought' })).toHaveAttribute('href', '/library/loose')
    expect(sidebar.queryByRole('link', { name: 'Projects' })).toBeNull()
  })
  it('opens a project folder and lets the user return to the Library root', async () => {
    show()
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /Team 1 recording/ }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Team' })).toBeVisible()
    expect(within(screen.getByRole('main')).getByRole('link', { name: /Project call/ })).toBeVisible()
    expect(within(screen.getByRole('main')).queryByRole('link', { name: /Quick thought/ })).toBeNull()
    fireEvent.click(within(screen.getByRole('main')).getByRole('link', { name: 'Library' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  })
  it('keeps global search able to find recordings inside folders', async () => {
    useAppStore.setState({ search: 'Budget' })
    show()
    expect(await within(screen.getByRole('main')).findByRole('link', { name: /Project call/ })).toBeVisible()
    expect(within(screen.getByRole('main')).queryByRole('region', { name: 'Project folders' })).toBeNull()
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
    await within(screen.getByRole('complementary')).findByRole('link', { name: 'Quick thought' })
    recordings[1] = { ...recordings[1], projectId: 'team' }
    changed.forEach(callback => callback())
    await waitFor(() => expect(within(screen.getByRole('complementary')).queryByRole('link', { name: 'Quick thought' })).toBeNull())
  })
})
