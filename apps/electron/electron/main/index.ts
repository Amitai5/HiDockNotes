import { app } from 'electron'
import product from '../../product.json'

app.setName(product.name)
if (process.argv.includes('--mcp-stdio')) {
  process.stderr.write('Desktop MCP has moved to the server. Copy the HTTPS configuration from Settings > Agent connections in your server library.\n')
  app.exit(1)
} else {
  void import('./hosted-client').catch(() => { console.error('HiDockNotes could not start.'); app.exit(1) })
}
