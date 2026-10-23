// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordingActions } from '../RecordingActions'
import type { RecordingView } from '../../shared/contracts'

const recording: RecordingView = { id: 'recording', filename: 'call.hda', title: 'Call', recordedAt: '2026-10-07T10:00:00Z', duration: 10, size: 100, status: 'done', verified: true, hasAudio: true, projectId: null, summary: 'Notes' }
afterEach(cleanup)
function show(canSummarize = true, canTranscribe = true) { return render(<RecordingActions recording={recording} canSummarize={canSummarize} canTranscribe={canTranscribe} canProcess={false} processReady retry={false} busy={false} onProcess={vi.fn()} onQueued={vi.fn()} />) }
describe('hamburger recording actions', () => {
  it('opens the three actions in a body portal, supports arrow keys and restores focus on Escape', () => {
    const view = show(), trigger = screen.getByRole('button', { name: 'Recording actions' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu')
    expect(view.container).not.toContainElement(menu)
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Resummarize', 'Retranscribe', 'Export', 'Delete recording'])
    expect(screen.getByRole('menuitem', { name: 'Resummarize' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Retranscribe' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'End' })
    expect(screen.getByRole('menuitem', { name: 'Delete recording' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
  it('skips unavailable processing actions and dismisses after an outside click', () => {
    show(false, false)
    fireEvent.click(screen.getByRole('button', { name: 'Recording actions' }))
    expect(screen.getByRole('menuitem', { name: 'Resummarize' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Retranscribe' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Export' })).toHaveFocus()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })
  it('opens the existing export choices and returns focus to the hamburger after closing', async () => {
    show()
    const trigger = screen.getByRole('button', { name: 'Recording actions' })
    fireEvent.click(trigger); fireEvent.click(screen.getByRole('menuitem', { name: 'Export' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(await screen.findByRole('dialog')).toHaveTextContent('Export recording')
    expect(screen.getByRole('radio', { name: /Summary only/ })).toBeVisible()
    expect(screen.getByLabelText('Include audio')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
