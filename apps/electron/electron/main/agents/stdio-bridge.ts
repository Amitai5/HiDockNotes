import { app, safeStorage } from 'electron'
import { join, isAbsolute } from 'node:path'
import { AgentConnectionStore, connectionFile } from './connection-store'
import { serveAgentMcp } from './mcp-server'
import { createConnection } from 'node:net'
import { once } from 'node:events'

export async function startAgentBridge(): Promise<void> {
  const index = process.argv.indexOf('--mcp-data-dir')
  const dataPath = index === -1 ? app.getPath('userData') : process.argv[index + 1]
  if (!dataPath || !isAbsolute(dataPath)) throw new Error('A valid app data directory is required.')
  const encryption = { isAvailable: () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'), encrypt: (value: string) => safeStorage.encryptString(value), decrypt: (value: Buffer) => safeStorage.decryptString(value) }
  const store = new AgentConnectionStore(connectionFile(join(dataPath, 'data', 'agent-connection.bin')), encryption)
  // Electron's windowless process needs a referenced handle while the stdio client is connected.
  const keepAlive = setInterval(() => undefined, 30000)
  const relayPort = Number(process.env.HIDOCKNOTES_MCP_RELAY_PORT)
  const relayToken = process.env.HIDOCKNOTES_MCP_RELAY_TOKEN
  let channel: ReturnType<typeof createConnection> | undefined
  if (relayToken !== undefined) {
    if (!Number.isSafeInteger(relayPort) || relayPort < 1 || relayPort > 65535 || !/^[A-Za-z0-9_-]{43}$/.test(relayToken)) throw new Error('Invalid MCP relay.')
    channel = createConnection({ host: '127.0.0.1', port: relayPort })
    await once(channel, 'connect')
    channel.write(JSON.stringify({ token: relayToken }) + '\n')
    delete process.env.HIDOCKNOTES_MCP_RELAY_TOKEN
    delete process.env.HIDOCKNOTES_MCP_RELAY_PORT
  }
  const server = await serveAgentMcp(async (name, argumentsValue, signal) => {
    // Re-read the encrypted connection for every call so disabling access takes effect immediately.
    const connection = await store.read()
    const response = await fetch(`http://127.0.0.1:${connection.port}/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + connection.token }, body: JSON.stringify({ name, arguments: argumentsValue }), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) })
    if (!response.ok) throw new Error('The local app could not read this tool.')
    const value = await response.json() as { result: unknown }
    return value.result
  }, channel ?? process.stdin, channel ?? process.stdout)
  let closing = false
  const close = (): void => { if (closing) return; closing = true; clearInterval(keepAlive); void server.close().finally(() => { channel?.end(); app.quit() }) }
  ;(channel ?? process.stdin).once('end', close)
  channel?.once('error', close)
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
}
