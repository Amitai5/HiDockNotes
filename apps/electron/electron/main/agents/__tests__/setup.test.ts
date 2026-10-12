import { describe, expect, it } from 'vitest'
import { agentSetup } from '../setup'

describe('MCP setup commands', () => {
  it('produces portable stdio configurations with no secrets or extra runtimes', () => {
    const setup = agentSetup('C:\\Program Files\\HiDockNotes\\HiDockNotes.exe', 'C:\\Users\\Dana\\AppData\\Roaming\\HiDockNotes', 'win32', 'C:\\Program Files\\HiDockNotes\\resources\\mcp-launcher.cjs')
    expect(setup.codex).toContain('codex mcp add hidocknotes --env ELECTRON_RUN_AS_NODE=1 --')
    expect(setup.claude).toContain('--transport stdio --scope user')
    expect(JSON.parse(setup.other)).toMatchObject({ mcpServers: { hidocknotes: { args: ['C:\\Program Files\\HiDockNotes\\resources\\mcp-launcher.cjs', '--mcp-data-dir', 'C:\\Users\\Dana\\AppData\\Roaming\\HiDockNotes'], env: { ELECTRON_RUN_AS_NODE: '1' } } } })
    expect(JSON.stringify(setup)).not.toMatch(/token|Authorization|api.key/i)
  })
  it('quotes literal apostrophes and dollar signs safely in Windows commands', () => {
    const setup = agentSetup("C:\\Dana's $App\\HiDockNotes.exe", 'C:\\notes', 'win32', 'C:\\launcher.cjs')
    expect(setup.codex).toContain("'C:\\Dana''s $App\\HiDockNotes.exe'")
  })
  it('passes the development app entry explicitly', () => {
    const setup = agentSetup('/Electron', '/notes', 'darwin', '/launcher.js', '/project/apps/electron')
    expect(JSON.parse(setup.other).mcpServers.hidocknotes.args).toEqual(['/launcher.js', '--mcp-app', '/project/apps/electron', '--mcp-data-dir', '/notes'])
  })
})
