// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RecordingWorkspace } from '../RecordingWorkspace'

afterEach(cleanup)
describe('resizable recording sidebar', () => {
  it('separates notes from playback and supports bounded keyboard resizing', () => {
    render(<RecordingWorkspace notes={<h2>Summary</h2>} media={<h2>Transcript</h2>} />)
    const handle = screen.getByRole('separator', { name: 'Resize audio and transcript sidebar' })
    expect(screen.getByRole('complementary', { name: 'Audio and transcript' })).toContainElement(screen.getByText('Transcript'))
    expect(screen.getByRole('complementary')).not.toContainElement(screen.getByText('Summary'))
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '400')
    fireEvent.keyDown(handle, { key: 'Home' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    fireEvent.keyDown(handle, { key: 'End' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(handle).toHaveAttribute('aria-valuenow', '800')
    fireEvent.doubleClick(handle)
    expect(handle).toHaveAttribute('aria-valuenow', '380')
  })
})
