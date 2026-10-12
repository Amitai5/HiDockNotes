import { app } from 'electron'
import product from '../../product.json'
import { isAbsolute } from 'node:path'

app.setName(product.name)
if (process.argv.includes('--mcp-stdio')) {
  const index = process.argv.indexOf('--mcp-data-dir')
  if (index !== -1) {
    const directory = process.argv[index + 1]
    if (!directory || !isAbsolute(directory)) { process.stderr.write('Use a valid HiDockNotes app data directory.\n'); app.exit(1) }
    // safeStorage unlocks the key associated with this profile before app readiness.
    app.setPath('userData', directory)
    app.setPath('sessionData', directory)
  }
  // Keep this path free of USB, SQLite, worker, and window initialization.
  app.whenReady().then(async () => {
    const { startAgentBridge } = await import('./agents/stdio-bridge')
    await startAgentBridge()
  }).catch(() => { process.stderr.write('HiDockNotes MCP could not start. Check Settings > Agent connections.\n'); app.exit(1) })
} else {
  void import('./desktop').catch(() => { console.error('HiDockNotes could not start.'); app.exit(1) })
}
