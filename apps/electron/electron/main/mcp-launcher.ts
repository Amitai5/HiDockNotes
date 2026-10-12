import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Socket } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { waitForWindowsEncryptionProfile } from './agents/encryption-profile'

const dataIndex = process.argv.indexOf('--mcp-data-dir')
const dataPath = process.argv[dataIndex + 1]
const appIndex = process.argv.indexOf('--mcp-app')
const entry = appIndex === -1 ? null : process.argv[appIndex + 1]
if (dataIndex === -1 || !dataPath || !isAbsolute(dataPath) || entry !== null && (!entry || !isAbsolute(entry))) {
  process.stderr.write('Use the MCP setup command from HiDockNotes Settings.\n')
  process.exitCode = 1
} else {
  // GUI Electron's Windows stdio can be redirected by Chromium. The bundled Node
  // runtime relays the client's stdio through a private, authenticated local socket.
  const token = randomBytes(32).toString('base64url')
  let child: ChildProcess | undefined
  let channel: Socket | undefined
  const server = createServer(socket => {
    let buffer = Buffer.alloc(0)
    socket.setTimeout(5000, () => socket.destroy())
    const authenticate = (chunk: Buffer): void => {
      buffer = Buffer.concat([buffer, chunk])
      if (buffer.length > 1024) { socket.destroy(); return }
      const end = buffer.indexOf(10)
      if (end === -1) return
      let provided: unknown
      try { provided = (JSON.parse(buffer.subarray(0, end).toString('utf8')) as { token?: unknown }).token } catch { socket.destroy(); return }
      if (typeof provided !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(provided) || !timingSafeEqual(Buffer.from(provided), Buffer.from(token)) || channel) { socket.destroy(); return }
      socket.removeListener('data', authenticate)
      socket.setTimeout(0)
      clearTimeout(startup)
      channel = socket
      server.close()
      process.stdin.pipe(socket)
      socket.pipe(process.stdout)
      if (end + 1 < buffer.length) process.stdout.write(buffer.subarray(end + 1))
      socket.on('error', () => child?.kill('SIGTERM'))
    }
    socket.on('data', authenticate)
    socket.on('error', () => undefined)
  })
  server.maxConnections = 8
  const startup = setTimeout(() => { process.stderr.write('HiDockNotes MCP helper did not connect.\n'); child?.kill('SIGTERM'); server.close(); process.exitCode = 1 }, 30000)
  server.once('error', () => { clearTimeout(startup); process.stderr.write('HiDockNotes MCP relay could not start.\n'); process.exitCode = 1 })
  server.listen(0, '127.0.0.1', () => {
    void startHelper().catch(() => { clearTimeout(startup); server.close(); process.stderr.write('HiDockNotes MCP encryption profile is unavailable. Keep the app running and reconnect.\n'); process.exitCode = 1 })
  })
  async function startHelper(): Promise<void> {
    // Starting before Chromium commits a fresh key would create a different key in the helper.
    if (process.platform === 'win32') await waitForWindowsEncryptionProfile(() => readFile(join(dataPath, 'Local State'), 'utf8'), () => delay(250))
    const address = server.address()
    if (!address || typeof address === 'string') return
    const environment: NodeJS.ProcessEnv = { ...process.env, ELECTRON_NO_ATTACH_CONSOLE: '1', HIDOCKNOTES_MCP_RELAY_PORT: String(address.port), HIDOCKNOTES_MCP_RELAY_TOKEN: token }
    delete environment.ELECTRON_RUN_AS_NODE
    child = spawn(process.execPath, [...(entry ? [entry] : []), '--mcp-stdio', '--mcp-data-dir', dataPath], { env: environment, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    child.stderr?.pipe(process.stderr)
    child.once('error', () => { clearTimeout(startup); server.close(); process.stderr.write('HiDockNotes MCP helper could not start.\n'); process.exitCode = 1 })
    child.once('exit', code => { clearTimeout(startup); server.close(); if (channel) { process.stdin.unpipe(channel); channel.end() } process.stdin.pause(); process.exitCode = code ?? 1 })
  }
  process.stdin.on('error', () => channel?.end())
  process.once('SIGTERM', () => { clearTimeout(startup); channel?.end(); child?.kill('SIGTERM'); server.close() })
  process.once('SIGINT', () => { clearTimeout(startup); channel?.end(); child?.kill('SIGTERM'); server.close() })
}
