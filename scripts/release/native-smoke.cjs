const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const { root, readVersion } = require('./version.cjs')

function smoke(resources) {
  const load = createRequire(resources ? path.join(resources, 'app.asar', 'package.json') : path.join(root, 'apps/electron/package.json'))
  const Database = load('better-sqlite3')
  const database = new Database(':memory:')
  try {
    database.exec('CREATE VIRTUAL TABLE smoke USING fts5(text); INSERT INTO smoke VALUES (\'local notes\')')
    assert.equal(database.prepare("SELECT count(*) AS count FROM smoke WHERE smoke MATCH 'notes'").get().count, 1)
  } finally { database.close() }
  assert.equal(typeof load('usb').findByIds, 'function')
  assert.equal(typeof load('sherpa-onnx-node').OfflineRecognizer, 'function')
  assert.equal(typeof load('ical.js').parse, 'function')
  // Speech and search use different ONNX runtimes; match the app's worker
  // isolation instead of loading both DLL versions into one Windows process.
  const searchCheck = spawnSync(process.execPath, [__filename, '--search-runtime', ...(resources ? [resources] : [])], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (searchCheck.error) { throw searchCheck.error }
  if (searchCheck.status !== 0) { throw new Error(`Search runtime check failed for ${process.platform}-${process.arch}:\n${searchCheck.stderr}`) }
  assert.equal(typeof load('electron-updater').NsisUpdater, 'function')
  assert.ok(fs.statSync(path.join(path.dirname(load.resolve('electron-updater/package.json')), 'LICENSE')).size > 0, 'updater license')
  const ffmpeg = load('ffmpeg-static').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  const conversion = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  if (conversion.error) { throw conversion.error }
  assert.equal(conversion.status, 0, conversion.stderr)
  assert.match(conversion.stdout, /ffmpeg version/)
  if (resources) {
    const searchLoad = createRequire(load.resolve('@huggingface/transformers'))
    const runtime = path.join(path.dirname(searchLoad.resolve('onnxruntime-node/package.json')), 'bin/napi-v6')
    assert.deepEqual(fs.readdirSync(runtime), [process.platform], 'installer contains only its own ONNX platform')
    assert.deepEqual(fs.readdirSync(path.join(runtime, process.platform)), [process.arch], 'installer contains only its own ONNX architecture')
    const policy = load('./resources/update-policy.json')
    assert.equal(typeof policy.signed, 'boolean')
    if (policy.signed) { assert.match(policy.publicKey, /BEGIN PUBLIC KEY/) }
    assert.equal(load('./package.json').version, readVersion())
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'mcp-launcher.cjs']) { assert.ok(fs.statSync(path.join(resources, file)).size > 0, file) }
    for (const file of ['out/main/index.js', 'out/main/transcription-worker.js', 'out/main/embedding-worker.js', 'out/main/calendar-worker.js', 'out/preload/index.js', 'out/renderer/index.html']) {
      assert.ok(fs.statSync(path.join(resources, 'app.asar', file)).size > 0, file)
    }
  }
  console.log(`Native smoke passed for ${process.platform}-${process.arch}${resources ? ' (packaged Electron)' : ' (Node)'}. SQLite/FTS, USB binding, speech and search runtimes, calendar parser, updater and ffmpeg loaded.`)
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
  if (result.error) { throw result.error }
  if (result.status !== 0) { throw new Error(`Packaged native smoke failed (exit ${result.status}, signal ${result.signal}).`) }
}

async function searchRuntimeSmoke(resources) {
  const load = createRequire(resources ? path.join(resources, 'app.asar', 'package.json') : path.join(root, 'apps/electron/package.json'))
  assert.equal(typeof load('@huggingface/transformers').pipeline, 'function')
  const ort = createRequire(load.resolve('@huggingface/transformers'))('onnxruntime-node')
  // A float32[1] Identity graph (ONNX IR 8, opset 13). No model download is needed.
  const model = Buffer.from('08083a420a100a017812017922084964656e74697479120c6e61746976652d736d6f6b655a0f0a0178120a0a08080112040a020801620f0a0179120a0a08080112040a0208014202100d', 'hex')
  const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 })
  try {
    const result = await session.run({ x: new ort.Tensor('float32', Float32Array.from([42]), [1]) })
    assert.deepEqual(Array.from(result.y.data), [42])
  } finally { await session.release() }
}

if (require.main === module) {
  void (async () => {
    if (process.argv[2] === '--search-runtime') {
      await searchRuntimeSmoke(process.argv[3])
    }
    else if (process.argv[2] === '--packaged') { packagedSmoke() }
    else { smoke(process.argv[2] === '--resources' ? process.argv[3] : undefined) }
  })().catch(error => { console.error(error.message); process.exitCode = 1 })
}
