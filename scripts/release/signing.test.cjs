const { test } = require('node:test')
const assert = require('node:assert/strict')
const { generateKeyPairSync, verify } = require('node:crypto')
const { signingPolicy, signManifest } = require('./signing.cjs')
const { expectedArtifacts } = require('./artifacts.cjs')

function keys() {
  const pair = generateKeyPairSync('ed25519')
  return { UPDATE_SIGNING_PUBLIC_KEY: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), UPDATE_SIGNING_PRIVATE_KEY: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() }
}
test('manual-download builds do not enable trusted in-app installation', () => {
  assert.deepEqual(signingPolicy({}), { signed: false, publicKey: '', publisher: '' })
})
test('signed Windows and Mac builds fail closed when credentials are incomplete', () => {
  const env = { HIDOCKNOTES_SIGNED_RELEASE: 'true', ...keys() }
  assert.throws(() => signingPolicy(env, 'win32'), /WIN_CSC_LINK/)
  assert.throws(() => signingPolicy(env, 'darwin'), /CSC_LINK/)
  assert.equal(signingPolicy(env, 'linux').signed, true)
})
test('the signed release manifest verifies with the packaged public key and detects modification', () => {
  const env = keys(), manifest = { format: 1, version: '0.10.0', artifacts: [{ name: 'fixture.AppImage', sha256: 'abc' }] }
  const result = signManifest(manifest, env), signature = Buffer.from(result.signature.toString().trim(), 'base64')
  assert.equal(verify(null, result.bytes, env.UPDATE_SIGNING_PUBLIC_KEY, signature), true)
  assert.equal(verify(null, Buffer.from('changed manifest'), env.UPDATE_SIGNING_PUBLIC_KEY, signature), false)
  assert.throws(() => signManifest(manifest, { ...env, UPDATE_SIGNING_PUBLIC_KEY: keys().UPDATE_SIGNING_PUBLIC_KEY }), /do not match/)
})
test('signed releases include Mac update ZIPs and a distinct update feed for each native architecture', () => {
  const files = expectedArtifacts('0.10.0', true)
  assert.ok(files['macos-x64'].includes('latest-x64-mac.yml'))
  assert.ok(files['macos-arm64'].includes('latest-arm64-mac.yml'))
  assert.ok(files['macos-arm64'].includes('HiDockNotes-0.10.0-macos-arm64.zip'))
  assert.ok(files['windows-x64'].includes('latest.yml'))
  assert.ok(files['linux-x64'].includes('latest-linux.yml'))
})
