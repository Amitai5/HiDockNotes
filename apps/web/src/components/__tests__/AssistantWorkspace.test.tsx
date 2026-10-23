// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AssistantWorkspace } from '../AssistantWorkspace'

afterEach(cleanup)
describe('Assistant source workspace', () => {
  it('resizes the source pane with the keyboard and leaves chat mounted when it closes', () => {
    const chat = <textarea aria-label="Draft" defaultValue="Keep this draft" />
    const view = render(<AssistantWorkspace chat={chat} source={<aside>Source</aside>} />)
    const input = screen.getByLabelText('Draft'), separator = screen.getByRole('separator', { name: 'Resize recording source panel' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator).toHaveAttribute('aria-valuenow', '390')
    fireEvent.keyDown(separator, { key: 'Home' })
    expect(separator).toHaveAttribute('aria-valuenow', '280')
    fireEvent.keyDown(separator, { key: 'End' })
    expect(separator).toHaveAttribute('aria-valuenow', '650')
    view.rerender(<AssistantWorkspace chat={chat} source={null} />)
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getByLabelText('Draft')).toBe(input)
    expect(input).toHaveValue('Keep this draft')
  })
})
