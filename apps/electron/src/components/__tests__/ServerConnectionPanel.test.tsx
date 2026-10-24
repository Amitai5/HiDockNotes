// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ServerConnectionPanel } from '../ServerConnectionPanel'
afterEach(cleanup)
it('connects explicitly to the server and explains that a local library is preserved', async () => {
  const connection = { get: vi.fn(async () => ({ origin: null })), connect: vi.fn(async () => undefined), useLocal: vi.fn(async () => undefined) }
  render(<ServerConnectionPanel connection={connection} />)
  await waitFor(() => expect(connection.get).toHaveBeenCalledOnce())
  fireEvent.change(screen.getByLabelText('HiDockNotes server address'), { target: { value: 'https://notes.example.com' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect to server' }))
  await waitFor(() => expect(connection.connect).toHaveBeenCalledWith('https://notes.example.com'))
  expect(screen.getByText(/Existing local recordings stay/)).toBeVisible()
})
it('surfaces a failed connection choice and permits correcting the address', async () => {
  const connection = { get: async () => ({ origin: null }), connect: vi.fn(async () => { throw new Error('Use an HTTPS server address.') }), useLocal: vi.fn() }
  render(<ServerConnectionPanel connection={connection} />)
  await waitFor(() => expect(screen.getByLabelText('HiDockNotes server address')).toHaveValue(''))
  fireEvent.change(screen.getByLabelText('HiDockNotes server address'), { target: { value: 'http://truenas.local:10708' } }); fireEvent.click(screen.getByRole('button', { name: 'Connect to server' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('HTTPS'); expect(screen.getByRole('button', { name: 'Connect to server' })).toBeEnabled()
})
