// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import * as Dialog from '@radix-ui/react-dialog'
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ResponsiveActions } from '../ResponsiveActions'

afterEach(cleanup)
it('reveals secondary controls without remounting their drafts or changing the control tree', () => {
  const view = render(<ResponsiveActions label="Chat options"><input aria-label="Project draft" defaultValue="Kept" /></ResponsiveActions>)
  const trigger = screen.getByRole('button', { name: 'Chat options' }), input = screen.getByRole('textbox', { name: 'Project draft' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger); fireEvent.change(input, { target: { value: 'Still here' } })
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.pointerDown(document.body)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  expect(screen.getByRole('textbox', { name: 'Project draft' })).toBe(input)
  expect(input).toHaveValue('Still here')
  expect(view.container.querySelectorAll('input')).toHaveLength(1)
})
it('dismisses with Escape and restores the disclosure trigger focus', () => {
  render(<ResponsiveActions label="Project options"><button>Catch me up</button></ResponsiveActions>)
  const trigger = screen.getByRole('button', { name: 'Project options' })
  fireEvent.click(trigger); screen.getByRole('button', { name: 'Catch me up' }).focus()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(trigger).toHaveFocus()
})
it('keeps the parent disclosure available while a child modal is open', async () => {
  render(<ResponsiveActions label="Project options"><Dialog.Root><Dialog.Trigger>Project context</Dialog.Trigger><Dialog.Portal><Dialog.Overlay /><Dialog.Content aria-describedby={undefined}><Dialog.Title>Context</Dialog.Title><Dialog.Close>Done</Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root></ResponsiveActions>)
  const trigger = screen.getByRole('button', { name: 'Project options' })
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'Project context' }))
  await screen.findByRole('dialog')
  fireEvent.pointerDown(document.body)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Project context' })).toHaveFocus())
})
it('closes after a navigation action', () => {
  render(<ResponsiveActions label="Chat options"><button data-close-actions>New chat</button></ResponsiveActions>)
  const trigger = screen.getByRole('button', { name: 'Chat options' })
  fireEvent.click(trigger); fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
