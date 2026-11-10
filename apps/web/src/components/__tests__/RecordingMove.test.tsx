// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordingMove } from '../RecordingMove'
import type { RecordingView } from '../../shared/contracts'

const api = vi.hoisted(() => ({ list: vi.fn(), assign: vi.fn() }))
vi.mock('../../services/app-client', () => ({ appClient: { projects: api } }))
const recording: RecordingView = { id: 'recording', filename: 'call.hda', title: 'Call', recordedAt: '2026-10-07T10:00:00Z', duration: 10, size: 100, status: 'done', verified: true, hasAudio: true, projectId: 'current', summary: 'Kept summary' }
beforeEach(() => { vi.resetAllMocks(); api.list.mockResolvedValue([{ id: 'current', name: 'Current project', count: 1 }, { id: 'next', name: 'Next project', count: 0 }]); api.assign.mockResolvedValue(undefined) })
afterEach(cleanup)
function show() { const onOpenChange = vi.fn(), onMoved = vi.fn(); const view = render(<RecordingMove recording={recording} open onOpenChange={onOpenChange} onMoved={onMoved} />); return { ...view, onOpenChange, onMoved } }

it('moves the recording to a chosen project through the existing assignment API only', async () => {
  const view = show()
  expect(await screen.findByRole('radio', { name: 'Current project' })).toBeChecked()
  expect(screen.getByRole('button', { name: 'Move recording', exact: true })).toBeDisabled()
  expect(screen.getByRole('heading', { name: 'Move recording' })).toHaveFocus()
  fireEvent.click(screen.getByRole('radio', { name: 'Next project' }))
  fireEvent.click(screen.getByRole('button', { name: 'Move recording', exact: true }))
  await waitFor(() => expect(view.onMoved).toHaveBeenCalledWith('next', 'Next project'))
  expect(api.assign).toHaveBeenCalledExactlyOnceWith('recording', 'next')
  expect(view.onOpenChange).toHaveBeenCalledWith(false)
  expect(recording.summary).toBe('Kept summary')
})

it('allows moving to Unfiled without downloading or processing audio', async () => {
  const view = show()
  fireEvent.click(await screen.findByRole('radio', { name: 'Unfiled items' }))
  fireEvent.click(screen.getByRole('button', { name: 'Move recording', exact: true }))
  await waitFor(() => expect(view.onMoved).toHaveBeenCalledWith(null, 'Unfiled items'))
  expect(api.assign).toHaveBeenCalledWith('recording', null)
})

it('keeps a failed move open with the chosen destination for retry', async () => {
  api.assign.mockRejectedValueOnce(new Error('Server unavailable'))
  const view = show()
  fireEvent.click(await screen.findByRole('radio', { name: 'Next project' }))
  fireEvent.click(screen.getByRole('button', { name: 'Move recording', exact: true }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable')
  expect(view.onOpenChange).not.toHaveBeenCalled()
  expect(screen.getByRole('radio', { name: 'Next project' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Move recording', exact: true }))
  await waitFor(() => expect(view.onOpenChange).toHaveBeenCalledWith(false))
  expect(api.assign).toHaveBeenCalledTimes(2)
})

it('reloads a failed project list and filters long project lists', async () => {
  api.list.mockRejectedValueOnce(new Error('Projects unavailable'))
  show()
  expect(await screen.findByRole('alert')).toHaveTextContent('Projects unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Reload projects' }))
  await screen.findByRole('radio', { name: 'Next project' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Find a project' }), { target: { value: 'next' } })
  expect(screen.getAllByRole('radio')).toHaveLength(1)
  expect(screen.getByRole('radio', { name: 'Next project' })).toBeVisible()
})

it('prevents duplicate moves and dismissal while the assignment is pending', async () => {
  let resolve!: () => void
  api.assign.mockImplementation(() => new Promise<void>(done => { resolve = done }))
  const view = show()
  fireEvent.click(await screen.findByRole('radio', { name: 'Next project' }))
  const move = screen.getByRole('button', { name: 'Move recording', exact: true })
  fireEvent.click(move); fireEvent.click(move)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(api.assign).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(view.onOpenChange).not.toHaveBeenCalled()
  resolve()
  await waitFor(() => expect(view.onOpenChange).toHaveBeenCalledWith(false))
})

it('does not navigate or announce a pending move after the page unmounts', async () => {
  let resolve!: () => void
  api.assign.mockImplementation(() => new Promise<void>(done => { resolve = done }))
  const view = show()
  fireEvent.click(await screen.findByRole('radio', { name: 'Next project' }))
  fireEvent.click(screen.getByRole('button', { name: 'Move recording', exact: true }))
  view.unmount(); resolve()
  await waitFor(() => expect(api.assign).toHaveResolved())
  expect(view.onMoved).not.toHaveBeenCalled()
  expect(view.onOpenChange).not.toHaveBeenCalled()
})
