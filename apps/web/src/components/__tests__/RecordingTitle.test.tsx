import { setAppClient } from '../../services/app-client'
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecordingTitle } from '../RecordingTitle'
import type { AppClient } from '../../shared/contracts'
import { useAppStore } from '../../store/useAppStore'

describe('recording title editing', () => {
  const rename = vi.fn()
  beforeEach(() => { rename.mockReset().mockResolvedValue(undefined); setAppClient({ library: { rename } } as unknown as AppClient); useAppStore.setState({ error: null }) })
  afterEach(cleanup)
  it('persists a trimmed title and refreshes the recording after save', async () => {
    const saved = vi.fn()
    render(<RecordingTitle id="recording" title="Original.hda" onSaved={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename recording' }))
    fireEvent.change(screen.getByLabelText('Recording title'), { target: { value: '  Planning with Dana  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rename).toHaveBeenCalledWith('recording', 'Planning with Dana'))
    await waitFor(() => expect(saved).toHaveBeenCalledOnce())
  })
  it('cancels with Escape without changing the saved recording', () => {
    render(<RecordingTitle id="recording" title="Original.hda" onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename recording' }))
    fireEvent.keyDown(screen.getByLabelText('Recording title'), { key: 'Escape' })
    expect(screen.getByRole('heading')).toHaveTextContent('Original.hda')
    expect(rename).not.toHaveBeenCalled()
  })
  it('keeps the editor open and reports failed persistence', async () => {
    rename.mockRejectedValue(new Error('Database is read-only.'))
    render(<RecordingTitle id="recording" title="Original.hda" onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rename recording' }))
    fireEvent.change(screen.getByLabelText('Recording title'), { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(useAppStore.getState().error).toBe('Database is read-only.'))
    expect(screen.getByLabelText('Recording title')).toHaveValue('New name')
  })
})
