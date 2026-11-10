// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { LibraryContentList } from '../LibraryContentList'
import type { RecordingView } from '../../shared/contracts'
import type { LibraryContentRow } from '../../shared/library'

const recording: RecordingView = { id: 'recording', filename: 'call.hda', title: 'Call', recordedAt: '2026-10-07T10:00:00Z', duration: 10, size: 100, status: 'done', verified: true, hasAudio: true, projectId: 'project', summary: 'Summary' }
const items: LibraryContentRow[] = [{ kind: 'recording', id: recording.id, title: recording.title, projectId: 'project', projectName: 'Project', preview: 'Summary', createdAt: recording.recordedAt, updatedAt: recording.recordedAt, recording }]
afterEach(cleanup)
function Location(): JSX.Element { return <output>{useLocation().pathname}</output> }
it('offers a separate keyboard/touch move control without nesting it inside or following the recording link', () => {
  const move = vi.fn()
  render(<MemoryRouter initialEntries={['/library']}><LibraryContentList items={items} onMoveRecording={move} /><Location /></MemoryRouter>)
  const button = screen.getByRole('button', { name: 'Move Call to project' })
  expect(button.closest('a')).toBeNull()
  expect(screen.getByRole('link')).toHaveAttribute('draggable', 'true')
  fireEvent.click(button)
  expect(move).toHaveBeenCalledExactlyOnceWith(recording, button)
  expect(screen.getByRole('status')).toHaveTextContent('/library')
})
