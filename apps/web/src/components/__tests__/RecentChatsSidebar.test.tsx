// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setAppClient } from '../../services/app-client'
import type { AppClient } from '../../shared/contracts'
import { RecentChatsSidebar } from '../RecentChatsSidebar'
const list = vi.fn(), current = vi.fn()
beforeEach(() => {
  list.mockReset().mockResolvedValue([{ id: 'saved', title: 'Pilot scope' }]); current.mockReset().mockResolvedValue({ conversation: { id: 'saved' } })
  setAppClient({ conversations: { list, current, onChanged: () => () => undefined } } as unknown as AppClient)
})
afterEach(cleanup)
it('requests an explicit empty search string and links a real saved conversation', async () => {
  render(<MemoryRouter initialEntries={['/assistant']}><RecentChatsSidebar /></MemoryRouter>)
  const saved = await screen.findByRole('link', { name: 'Pilot scope' })
  expect(list).toHaveBeenCalledWith(''); expect(saved).toHaveAttribute('href', '/assistant?chat=saved'); expect(saved).toHaveClass('active')
  expect(screen.getByRole('link', { name: 'All chats' })).toHaveAttribute('href', '/assistant?history=1')
})
it('does not mark the previous server conversation active while composing a new chat', async () => {
  render(<MemoryRouter initialEntries={['/assistant?new=draft']}><RecentChatsSidebar /></MemoryRouter>)
  expect(await screen.findByRole('link', { name: 'Pilot scope' })).not.toHaveClass('active')
})
