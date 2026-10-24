const assert = require('node:assert/strict')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const load = createRequire(path.resolve(__dirname, '../../packages/core/package.json'))

async function main() {
  if (process.argv.includes('--search-runtime')) {
    assert.equal(typeof load('@huggingface/transformers').pipeline, 'function')
    const ort = createRequire(load.resolve('@huggingface/transformers'))('onnxruntime-node')
    const model = Buffer.from('08083a420a100a017812017922084964656e74697479120c6e61746976652d736d6f6b655a0f0a0178120a0a08080112040a020801620f0a0179120a0a08080112040a0208014202100d', 'hex')
    const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 })
    try { const result = await session.run({ x: new ort.Tensor('float32', Float32Array.from([42]), [1]) }); assert.deepEqual(Array.from(result.y.data), [42]) }
    finally { await session.release() }
    return
  }
  const Database = load('better-sqlite3'), database = new Database(':memory:')
  try { database.exec("CREATE VIRTUAL TABLE smoke USING fts5(text); INSERT INTO smoke VALUES ('server notes')"); assert.equal(database.prepare("SELECT count(*) AS count FROM smoke WHERE smoke MATCH 'notes'").get().count, 1) }
  finally { database.close() }
  assert.equal(typeof load('sherpa-onnx-node').OfflineRecognizer, 'function')
  assert.equal(typeof load('ical.js').parse, 'function')
  // Keep speech and search ONNX libraries isolated, as they are in production workers.
  const search = spawnSync(process.execPath, [__filename, '--search-runtime'], { encoding: 'utf8', timeout: 60000, windowsHide: true })
  if (search.error) throw search.error
  assert.equal(search.status, 0, search.stderr)
  const ffmpeg = spawnSync(load('ffmpeg-static'), ['-version'], { encoding: 'utf8', timeout: 30000, windowsHide: true })
  if (ffmpeg.error) throw ffmpeg.error
  assert.equal(ffmpeg.status, 0, ffmpeg.stderr); assert.match(ffmpeg.stdout, /ffmpeg version/)
  console.log('Server SQLite/FTS, speech, search CPU inference, calendar and audio conversion runtime smoke passed.')
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
