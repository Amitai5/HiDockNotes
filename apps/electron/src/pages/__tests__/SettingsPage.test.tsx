// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPage } from '../SettingsPage'
import { useAppStore } from '../../store/useAppStore'
import type { ElectronAPI } from '../../shared/contracts'
import { EMPTY_REFERENCE_CONTEXT } from '../../shared/reference-context'

vi.mock('../../components/AISettingsPanel', () => ({ AISettingsPanel: ({ sections }: { sections: string[] }) => <>{sections.includes('providers') && <section id="ai-providers" tabIndex={-1}>Provider controls</section>}{sections.includes('transcription') && <section id="transcription" tabIndex={-1}>Language controls</section>}{sections.includes('thresholds') && <section id="voice-thresholds" tabIndex={-1}>Threshold controls</section>}</> }))
vi.mock('../../components/VoiceProfilesPanel', () => ({ VoiceProfilesPanel: () => <section id="voice-profiles" tabIndex={-1}>Voice controls</section> }))
vi.mock('../../components/AgentConnectionsPanel', () => ({ AgentConnectionsPanel: () => <section id="agent-connections" tabIndex={-1}>Agent controls</section> }))
const update = vi.fn()
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  useAppStore.setState({ settings: { name: 'Dana', appearance: 'dark', autoConnect: true, autoDownload: true, recordingsPath: '/audio' }, error: null })
  update.mockReset().mockImplementation(async patch => ({ ...useAppStore.getState().settings, ...patch }))
  window.electronAPI = { app: { info: vi.fn(async () => ({ version: '0.5.0', electron: '44', platform: 'win32' })) }, settings: { update }, backups: { state: vi.fn(async () => ({ phase: 'idle' })), onState: vi.fn(() => vi.fn()), create: vi.fn(async () => null) } } as unknown as ElectronAPI
})
afterEach(cleanup)
describe('searchable Settings tabs', () => {
  it('finds global context through terminology search and preserves its draft between tabs', async () => {
    window.electronAPI.referenceContext = { get: vi.fn(async () => ({ content: { ...EMPTY_REFERENCE_CONTEXT }, version: 0, updatedAt: null })), save: vi.fn() }
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'glossary' } })
    fireEvent.click(screen.getByRole('button', { name: /Global context & terminology/ }))
    await waitFor(() => expect(screen.getByLabelText('Global terminology & spellings')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Global terminology & spellings'), { target: { value: 'Saved later' } })
    fireEvent.click(screen.getByRole('tab', { name: 'AI & transcription' }))
    fireEvent.click(screen.getByRole('tab', { name: 'General' }))
    expect(screen.getByLabelText('Global terminology & spellings')).toHaveValue('Saved later')
  })
  it('shows General first and keeps other panels hidden', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Your name')).toBeVisible()
    expect(screen.getByText('Provider controls')).not.toBeVisible()
    expect(screen.getByText('Agent controls')).not.toBeVisible()
    fireEvent.click(screen.getByRole('tab', { name: 'Agent connections' }))
    expect(screen.getByText('Agent controls')).toBeVisible()
    expect(screen.getByLabelText('Your name')).not.toBeVisible()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })
  it('finds a setting across all tabs and opens the relevant section', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'language' } })
    fireEvent.click(screen.getByRole('button', { name: /Transcription language/ }))
    expect(screen.getByRole('tab', { name: 'AI & transcription' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Language controls')).toBeVisible()
    await waitFor(() => expect(document.activeElement).toHaveAttribute('id', 'transcription'))
    expect(screen.getByLabelText('Search settings')).toHaveValue('')
  })
  it('supports Enter to open a result and Escape to clear an empty search', () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'MCP' } })
    fireEvent.keyDown(screen.getByLabelText('Search settings'), { key: 'Enter' })
    expect(screen.getByText('Agent controls')).toBeVisible()
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'does-not-exist' } })
    expect(screen.getByText('No matching settings')).toBeVisible()
    fireEvent.keyDown(screen.getByLabelText('Search settings'), { key: 'Escape' })
    expect(screen.getByText('Agent controls')).toBeVisible()
  })
  it('supports arrow-key tab navigation while preserving a name draft', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'New name' } })
    fireEvent.keyDown(screen.getByRole('tab', { name: 'General' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'AI & transcription' })).toHaveFocus()
    fireEvent.click(screen.getByRole('tab', { name: 'General' }))
    expect(screen.getByLabelText('Your name')).toHaveValue('New name')
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ name: 'New name' }))
  })
  it('finds the complete backup through Settings search and opens its controls', async () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Search settings'), { target: { value: 'backup' } })
    fireEvent.click(screen.getByRole('button', { name: /Library backup/ }))
    expect(screen.getByRole('tab', { name: 'Device & storage' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }))
    await waitFor(() => expect(window.electronAPI.backups.create).toHaveBeenCalledOnce())
  })
})
