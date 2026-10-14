// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CopyAnswer } from '../CopyAnswer'
import type { ElectronAPI } from '../../shared/contracts'
import { useAppStore } from '../../store/useAppStore'

const copyText = vi.fn()
beforeEach(() => { copyText.mockReset().mockResolvedValue(undefined); useAppStore.setState({ error: null }); window.electronAPI = { app: { copyText } } as unknown as ElectronAPI })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('copyable Assistant answers', () => {
  it('copies the full original answer and shows temporary confirmation', async () => {
    const text = '## Decision\n\nUse **lane change**. [1]\n'
    vi.useFakeTimers()
    render(<CopyAnswer text={text} />)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Copy answer' })))
    expect(copyText).toHaveBeenCalledExactlyOnceWith(text)
    expect(screen.getByRole('button', { name: 'Answer copied' })).toBeVisible()
    act(() => vi.advanceTimersByTime(2000))
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeVisible()
  })
  it('does not claim success if the clipboard fails', async () => {
    copyText.mockRejectedValue(new Error('Clipboard unavailable.'))
    render(<CopyAnswer text="Answer" />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy answer' }))
    await waitFor(() => expect(useAppStore.getState().error).toBe('Clipboard unavailable.'))
    expect(screen.queryByRole('button', { name: 'Answer copied' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy answer' })).toBeEnabled()
  })
})
