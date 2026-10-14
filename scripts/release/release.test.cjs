const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { assertVersion, validateManifests, setVersion } = require('./version.cjs')
const { githubClient, tagCommit } = require('./github.cjs')
const { releasePlan } = require('./prepare.cjs')
const { expectedArtifacts, verifyArtifacts } = require('./artifacts.cjs')
const { verifyUploadedAssets } = require('./publish.cjs')

function manifests() {
  return {
    'package.json': { version: '0.9.3', scripts: { build: 'existing build' } },
    'apps/electron/package.json': { version: '0.9.3', dependencies: { usb: '2.17.0' } },
    'apps/electron/product.json': { version: '0.9.3', appId: 'org.hidocknotes.app' },
    'package-lock.json': { version: '0.9.3', packages: { '': { version: '0.9.3' }, 'apps/electron': { version: '0.9.3' }, 'packages/jensen-protocol': { version: '0.1.0' } } }
  }
}

test('accepts stable and prerelease versions that are safe in tags and asset names', () => {
  for (const version of ['0.9.3', '1.0.0-beta.1', '1.0.0-rc', '1.0.0-beta-build.0']) { assert.equal(assertVersion(version), version) }
})

test('rejects malformed versions and shell/path characters', () => {
  for (const version of ['v0.9.3', '0.9', '01.2.3', '1.2.3-beta.01', '1.2.3+build', '1.2.3/../../', '1.2.3;exit', undefined]) {
    assert.throws(() => assertVersion(version))
  }
})

test('requires consistent versions including lockfile workspace entries', () => {
  const data = manifests()
  assert.equal(validateManifests(data), '0.9.3')
  data['package-lock.json'].packages['apps/electron'].version = '0.8.0'
  assert.throws(() => validateManifests(data), /expected 0.9.3/)
})

test('version bump preserves dependencies, app identity and protocol version', () => {
  const data = setVersion(manifests(), '0.9.4')
  assert.equal(validateManifests(data), '0.9.4')
  assert.equal(data['apps/electron/package.json'].dependencies.usb, '2.17.0')
  assert.equal(data['apps/electron/product.json'].appId, 'org.hidocknotes.app')
  assert.equal(data['package-lock.json'].packages['packages/jensen-protocol'].version, '0.1.0')
  assert.equal(data['package.json'].scripts.build, 'existing build')
})

test('invalid version bump leaves manifests intact', () => {
  const data = manifests()
  assert.throws(() => setVersion(data, '../bad'))
  assert.equal(validateManifests(data), '0.9.3')
})

test('GitHub authentication errors fail instead of appearing to be a missing release', async () => {
  const api = githubClient({ GH_TOKEN: 'test-token', GITHUB_REPOSITORY: 'owner/repo' }, async () => ({ status: 401, ok: false }))
  await assert.rejects(api('releases/tags/v0.9.3'), /HTTP 401/)
})

test('GitHub GET 404 means missing but failed mutations remain errors', async () => {
  const api = githubClient({ GH_TOKEN: 'test-token', GITHUB_REPOSITORY: 'owner/repo' }, async () => ({ status: 404, ok: false }))
  assert.equal(await api('releases/tags/v0.9.3'), null)
  await assert.rejects(api('git/refs', 'POST', {}), /HTTP 404/)
})

test('requires a repository and token before using GitHub', () => {
  assert.throws(() => githubClient({ GITHUB_REPOSITORY: 'owner/repo' }), /required/)
  assert.throws(() => githubClient({ GH_TOKEN: 'test-token', GITHUB_REPOSITORY: '../bad' }), /required/)
})

test('resolves annotated version tags to their commit', async () => {
  const api = async endpoint => endpoint.startsWith('git/ref/') ? { object: { type: 'tag', sha: 'annotation' } } : { object: { type: 'commit', sha: 'commit' } }
  assert.equal(await tagCommit(api, 'v0.9.3'), 'commit')
})

test('rejects tags pointing to a tree or cyclic annotations', async () => {
  await assert.rejects(tagCommit(async () => ({ object: { type: 'tree', sha: 'tree' } }), 'v0.9.3'), /must resolve to a commit/)
  await assert.rejects(tagCommit(async () => ({ object: { type: 'tag', sha: 'cycle' } }), 'v0.9.3'), /must resolve to a commit/)
})

test('plans a new release when version has not been published', async () => {
  assert.deepEqual(await releasePlan(async () => null, '0.9.3', 'commit'), { version: '0.9.3', tag: 'v0.9.3', commit: 'commit', publish: 'true' })
})

test('published releases skip rebuilding and replacing public installers', async () => {
  const api = async endpoint => {
    assert.equal(endpoint, 'releases/tags/v0.9.3')
    return { draft: false }
  }
  assert.equal((await releasePlan(api, '0.9.3', 'new-commit')).publish, 'false')
})

test('allows an unfinished draft to resume only for the same commit', async () => {
  const api = async endpoint => endpoint.startsWith('releases/') ? { draft: true } : { object: { type: 'commit', sha: 'original' } }
  assert.equal((await releasePlan(api, '0.9.3', 'original')).publish, 'true')
  await assert.rejects(releasePlan(api, '0.9.3', 'changed'), /another commit/)
})

test('an existing tag cannot be moved even before a release exists', async () => {
  const api = async endpoint => endpoint.startsWith('releases/') ? null : { object: { type: 'commit', sha: 'original' } }
  await assert.rejects(releasePlan(api, '0.9.3', 'changed'), /another commit/)
})

async function withArtifacts(callback) {
  const prefix = path.join(os.tmpdir(), 'hidock-release-test-')
  const directory = fs.mkdtempSync(prefix)
  const names = Object.values(expectedArtifacts('0.9.3')).flat()
  for (const name of names) { fs.writeFileSync(path.join(directory, name), `fixture for ${name}`) }
  try { await callback(directory, names) } finally {
    assert.ok(path.resolve(directory).startsWith(prefix))
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('requires five platform installers and computes their exact checksums', async () => {
  await withArtifacts(async (directory, names) => {
    const assets = await verifyArtifacts(directory, '0.9.3')
    assert.equal(assets.length, 5)
    const asset = assets.find(file => file.name === names[0])
    assert.equal(asset.sha256, createHash('sha256').update(`fixture for ${names[0]}`).digest('hex'))
    assert.equal(asset.size, Buffer.byteLength(`fixture for ${names[0]}`))
  })
})

test('refuses a release missing any platform', async () => {
  await withArtifacts(async (directory, names) => {
    fs.unlinkSync(path.join(directory, names[4]))
    await assert.rejects(verifyArtifacts(directory, '0.9.3'), /exactly the Windows/)
  })
})

test('refuses empty installers and unexpected files in release assets', async () => {
  await withArtifacts(async (directory, names) => {
    fs.writeFileSync(path.join(directory, names[0]), '')
    await assert.rejects(verifyArtifacts(directory, '0.9.3'), /invalid installer/)
    fs.writeFileSync(path.join(directory, 'private.db'), 'must not ship')
    await assert.rejects(verifyArtifacts(directory, '0.9.3'), /exactly the Windows/)
  })
})

test('allows regenerated checksum file on a draft retry', async () => {
  await withArtifacts(async directory => {
    fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), 'old checksums')
    assert.equal((await verifyArtifacts(directory, '0.9.3')).length, 5)
  })
})

test('verifies uploaded sizes, states and server hashes before publishing', () => {
  const expected = [{ name: 'installer', size: 42, sha256: 'abc' }]
  assert.doesNotThrow(() => verifyUploadedAssets([{ name: 'installer', size: 42, state: 'uploaded', digest: 'sha256:abc' }], expected))
  for (const assets of [[], [{ name: 'installer', size: 41, state: 'uploaded' }], [{ name: 'installer', size: 42, state: 'new' }], [{ name: 'installer', size: 42, state: 'uploaded', digest: 'sha256:wrong' }]]) {
    assert.throws(() => verifyUploadedAssets(assets, expected), /unpublished/)
  }
})
