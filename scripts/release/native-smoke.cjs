const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const { root, readVersion } = require('./version.cjs')

const forbidden = ['better-sqlite3', 'ffmpeg-static', 'sherpa-onnx-node', 'onnxruntime-node', '@huggingface/transformers', '@google/genai', 'openai', 'ical.js', 'electron-updater', '@hidock/core']
function smoke(resources) {
  const directory = resources ? path.join(resources, 'app.asar') : path.join(root, 'apps/electron')
  const load = createRequire(path.join(directory, 'package.json'))
  assert.deepEqual(Object.keys(load('./package.json').dependencies).sort(), ['@hidock/jensen-protocol', 'usb'])
  assert.equal(typeof load('usb').findByIds, 'function')
  assert.equal(typeof load('@hidock/jensen-protocol').JensenDevice, 'function')
  for (const file of ['out/main/index.js', 'out/preload/server.js', 'out/renderer/server.html']) assert.ok(fs.statSync(path.join(directory, file)).size > 0, file)
  for (const file of ['out/main/desktop.js', 'out/main/transcription-worker.js', 'out/main/embedding-worker.js', 'out/main/calendar-worker.js', 'out/main/mcp-launcher.js', 'out/preload/index.js', 'out/renderer/index.html']) assert.ok(!fs.existsSync(path.join(directory, file)), `Desktop must not ship ${file}`)
  if (resources) {
    function inspectModules(folder) {
      if (!fs.existsSync(folder)) return
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const target = path.join(folder, entry.name)
        if (entry.name.startsWith('@')) { inspectModules(target); continue }
        const name = path.basename(folder).startsWith('@') ? path.basename(folder) + '/' + entry.name : entry.name
        assert.ok(!forbidden.includes(name) && !name.startsWith('sherpa-onnx-'), `Desktop must not ship ${name}`)
        inspectModules(path.join(target, 'node_modules'))
      }
    }
    inspectModules(path.join(directory, 'node_modules'))
    assert.equal(load('./package.json').version, readVersion())
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'icon.png']) assert.ok(fs.statSync(path.join(resources, file)).size > 0, file)
    assert.ok(!fs.existsSync(path.join(resources, 'mcp-launcher.cjs')), 'No local MCP launcher')
  }
  console.log(`Desktop client smoke passed for ${process.platform}-${process.arch}${resources ? ' (packaged Electron)' : ' (Node)'}. Native USB, server setup and restricted preload are present; local library, workers and AI runtimes are absent.`)
}

function packagedSmoke() {
  const directory = path.join(root, 'release', readVersion())
  let executable, resources
  if (process.platform === 'win32') {
    executable = path.join(directory, 'win-unpacked', 'HiDockNotes.exe')
    resources = path.join(directory, 'win-unpacked', 'resources')
  } else if (process.platform === 'linux') {
    executable = path.join(directory, 'linux-unpacked', 'hidocknotes-app')
    resources = path.join(directory, 'linux-unpacked', 'resources')
  } else if (process.platform === 'darwin') {
    const app = path.join(directory, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'HiDockNotes.app', 'Contents')
    executable = path.join(app, 'MacOS', 'HiDockNotes')
    resources = path.join(app, 'Resources')
  } else { throw new Error(`Unsupported platform ${process.platform}.`) }
  const result = spawnSync(executable, [__filename, '--resources', resources], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 60000, windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Packaged client smoke failed (exit ${result.status}, signal ${result.signal}).`)
}
if (require.main === module) {
  try { if (process.argv[2] === '--packaged') packagedSmoke(); else smoke(process.argv[2] === '--resources' ? process.argv[3] : undefined) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
