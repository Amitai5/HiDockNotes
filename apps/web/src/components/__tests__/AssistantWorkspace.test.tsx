// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AssistantWorkspace } from '../AssistantWorkspace'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('Assistant source workspace', () => {
  it('resizes the source pane with the keyboard and leaves chat mounted when it closes', () => {
    const chat = <textarea aria-label="Draft" defaultValue="Keep this draft" />
    const view = render(<AssistantWorkspace chat={chat} source={<aside>Source</aside>} />)
    const input = screen.getByLabelText('Draft'), separator = screen.getByRole('separator', { name: 'Resize source panel' })
    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(separator).toHaveAttribute('aria-valuenow', '460')
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

it('reserves room for the conversation and retains its draft across compact source layouts', () => {
  let resized = () => undefined as void
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resized = callback } observe() {} disconnect() {} })
  const view = render(<AssistantWorkspace chat={<textarea aria-label="Draft" defaultValue="Keep this draft" />} source={<aside>Source</aside>} />)
  const workspace = view.container.firstChild as HTMLElement, input = screen.getByLabelText('Draft')
  Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 1200 })
  act(resized)
  const separator = screen.getByRole('separator', { name: 'Resize source panel' })
  fireEvent.keyDown(separator, { key: 'End' })
  expect(separator).toHaveAttribute('aria-valuemax', '634')

  Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: 1000 })
  act(resized)
  expect(separator).toHaveAttribute('aria-valuenow', '634')
  expect(screen.getByLabelText('Draft')).toBe(input)
  expect(input).toHaveValue('Keep this draft')
})
