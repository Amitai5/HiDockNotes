import { appClient, setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActionablesPage } from '../ActionablesPage'
import type { ActionableView, AppClient } from '../../shared/contracts'

describe('open and completed action items', () => {
  let items: ActionableView[]
  beforeEach(() => {
    items = [{ id: 'task', recordingId: 'recording', text: 'Send the plan', done: false, start: 1, createdAt: '2026-10-08T12:00:00Z', dueDate: '2026-10-12', completedAt: null }]
    setAppClient({ library: { onChanged: vi.fn(() => vi.fn()) }, actionables: { list: vi.fn(async () => structuredClone(items)), update: vi.fn(async (id, patch) => { Object.assign(items.find(item => item.id === id)!, patch) }) } } as unknown as AppClient)
  })
  afterEach(cleanup)
  it('removes completed tasks from Open, keeps a Done indicator in Completed, and allows reopening', async () => {
    render(<MemoryRouter><ActionablesPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Send the plan' }))
    await waitFor(() => expect(screen.queryByText('Send the plan')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('marked done')
    fireEvent.click(screen.getByRole('button', { name: /Completed 1/ }))
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Reopen Send the plan' })).toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Reopen Send the plan' }))
    await waitFor(() => expect(screen.queryByText('Send the plan')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Open 1/ }))
    expect(screen.getByText('Send the plan')).toBeInTheDocument()
  })
  it('shows creation and expected dates, and lets the user change the expected date', async () => {
    render(<MemoryRouter><ActionablesPage /></MemoryRouter>)
    await screen.findByText('Send the plan')
    expect(document.querySelector('time[datetime="2026-10-08T12:00:00Z"]')).not.toBeNull()
    expect(document.querySelector('time[datetime="2026-10-12"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Send the plan' }))
    fireEvent.change(screen.getByLabelText('Action item due date'), { target: { value: '2026-10-15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(appClient.actionables.update).toHaveBeenCalledWith('task', { text: 'Send the plan', dueDate: '2026-10-15' }))
    await waitFor(() => expect(document.querySelector('time[datetime="2026-10-15"]')).not.toBeNull())
  })
  it('does not mark a task done when persistence fails', async () => {
    vi.mocked(appClient.actionables.update).mockRejectedValue(new Error('Database unavailable'))
    render(<MemoryRouter><ActionablesPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Send the plan' }))
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeEnabled())
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByText('Send the plan')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
