// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { BookOpen, MessageSquare, RefreshCw } from 'lucide-react'
import { MobileNavigation } from '../MobileNavigation'

vi.mock('../../hooks/useLibraryNavigation', () => ({ useLibraryNavigation: () => ({ projects: [{ id: 'project', name: 'Mobile project', count: 3 }], looseRecordings: [] }) }))
vi.mock('../BrowserControls', () => ({ SignOutButton: () => <button>Sign out</button> }))
vi.mock('../../services/app-client', () => ({ appClient: { projects: { create: vi.fn() } } }))
afterEach(cleanup)
const items = [{ label: 'Library', path: '/library', Icon: BookOpen }, { label: 'Assistant', path: '/assistant', Icon: MessageSquare }, { label: 'Sync', path: '/sync', Icon: RefreshCw }]
function Location(): JSX.Element { const location = useLocation(); return <output aria-label="Current route">{location.pathname}{location.search}</output> }
it('exposes projects, Unfiled, folder creation, settings and sign out without dragging', async () => {
  render(<MemoryRouter initialEntries={['/library']}><MobileNavigation items={items} /><Location /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
  expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Unfiled items' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'New project folder' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Settings' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible()
  fireEvent.click(screen.getByRole('link', { name: 'Mobile project' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/library?project=project')
})
it('closes with Escape and restores the navigation trigger focus', async () => {
  render(<MemoryRouter><MobileNavigation items={items} /></MemoryRouter>)
  const trigger = screen.getByRole('button', { name: 'Open navigation' })
  fireEvent.click(trigger)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(trigger).toHaveFocus()
})
