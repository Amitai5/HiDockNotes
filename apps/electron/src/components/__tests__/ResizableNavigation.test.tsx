// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ResizableNavigation } from '../ResizableNavigation'

afterEach(cleanup)
describe('resizable main navigation', () => {
  it('supports bounded keyboard resizing and double-click reset without moving navigation into the content', () => {
    render(<ResizableNavigation><header>HiDockNotes</header><aside id="navigation-sidebar">Library</aside><main>Recordings</main></ResizableNavigation>)
    const separator = screen.getByRole('separator', { name: 'Resize navigation sidebar' })
    expect(separator).toHaveAttribute('aria-valuenow', '232')
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', '252')
    fireEvent.keyDown(separator, { key: 'End' }); fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(separator).toHaveAttribute('aria-valuenow', '440')
    fireEvent.keyDown(separator, { key: 'Home' }); fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator).toHaveAttribute('aria-valuenow', '200')
    fireEvent.doubleClick(separator)
    expect(separator).toHaveAttribute('aria-valuenow', '232')
    expect(separator.closest('.app-shell')).toHaveStyle({ '--navigation-width': '232px' })
  })
})
