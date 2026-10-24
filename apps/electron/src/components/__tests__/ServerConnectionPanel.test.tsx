// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ServerConnectionPanel } from '../ServerConnectionPanel'
afterEach(cleanup)
it('requires a server connection on first launch and describes server storage and processing', async () => {
  const connection = { get: vi.fn(async () => ({ origin: null })), connect: vi.fn(async () => undefined) }
  render(<ServerConnectionPanel connection={connection} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect to server' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('HiDockNotes server address'), { target: { value: 'https://notes.example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect to server' }))
  await waitFor(() => expect(connection.connect).toHaveBeenCalledWith('https://notes.example.com'))
  expect(screen.getByText(/Your server stores recordings/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Reopening…' })).toBeDisabled()
})
it('allows changing the server without offering a local library', async () => {
  const connection = { get: async () => ({ origin: 'https://notes.example.com' }), connect: vi.fn() }
  render(<ServerConnectionPanel connection={connection} />)
  await waitFor(() => expect(screen.getByLabelText('HiDockNotes server address')).toHaveValue('https://notes.example.com'))
  expect(screen.queryByRole('button', { name: /local library/i })).not.toBeInTheDocument()
  expect(screen.getByText(/needs the server to use your library/)).toBeVisible()
})
it('surfaces a failed connection choice and permits correcting the address', async () => {
  const connection = { get: async () => ({ origin: null }), connect: vi.fn(async () => { throw new Error('Use an HTTPS server address.') }) }
  render(<ServerConnectionPanel connection={connection} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect to server' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('HiDockNotes server address'), { target: { value: 'http://truenas.local:10708' } }); fireEvent.click(screen.getByRole('button', { name: 'Connect to server' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS'); expect(screen.getByRole('button', { name: 'Connect to server' })).toBeEnabled()
})
it('explains an unavailable server and keeps the saved address for retry', async () => {
  render(<ServerConnectionPanel connection={{ get: async () => ({ origin: 'https://notes.example.com', error: 'Could not reach your server.' }), connect: vi.fn() }} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach your server.')
  expect(screen.getByLabelText('HiDockNotes server address')).toHaveValue('https://notes.example.com')
})
