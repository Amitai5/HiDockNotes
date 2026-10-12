// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AgentConnectionsPanel } from '../AgentConnectionsPanel'
import type { AgentConnectionState } from '../../shared/agents'
import type { ElectronAPI } from '../../shared/contracts'

let state: AgentConnectionState
const setEnabled = vi.fn(), copySetup = vi.fn()
beforeEach(() => {
  state = { enabled: false, running: false, error: null, tools: [{ name: 'search_recordings', description: 'Search your notes.' }], setup: { codex: 'codex mcp add hidocknotes -- app', claude: 'claude mcp add hidocknotes -- app', other: '{ "mcpServers": {} }' } }
  setEnabled.mockReset().mockImplementation(async enabled => ({ ...state, enabled, running: enabled }))
  copySetup.mockReset().mockResolvedValue(undefined)
  window.electronAPI = { agents: { state: vi.fn(async () => state), setEnabled, copySetup } } as unknown as ElectronAPI
})
afterEach(cleanup)
describe('agent connection settings', () => {
  it('is off by default and explains text sharing before access is enabled', async () => {
    render(<AgentConnectionsPanel />)
    expect(await screen.findByText('Agent access is off')).toBeVisible()
    expect(screen.getByRole('switch', { name: 'Enable MCP access' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/An agent may send the text it reads/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeDisabled()
  })
  it('enables and revokes access and copies the selected client setup', async () => {
    render(<AgentConnectionsPanel />)
    await screen.findByText('Agent access is off')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable MCP access' }))
    expect(await screen.findByText('Ready for your agent')).toBeVisible()
    expect(setEnabled).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
    expect(copySetup).toHaveBeenCalledWith('claude')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable MCP access' }))
    await screen.findByText('Agent access is off')
    expect(setEnabled).toHaveBeenLastCalledWith(false)
  })
  it('shows secure startup failure without claiming the server is ready', async () => {
    setEnabled.mockResolvedValueOnce({ ...state, enabled: true, running: false, error: 'Key storage unavailable.' })
    render(<AgentConnectionsPanel />)
    await screen.findByText('Agent access is off')
    fireEvent.click(screen.getByRole('switch', { name: 'Enable MCP access' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Key storage unavailable')
    expect(screen.queryByText('Ready for your agent')).toBeNull()
  })
})
