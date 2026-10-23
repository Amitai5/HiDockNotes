const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { imageMetadata } = require('./hosted.cjs')
const { releaseImageAsset, verifyLatestImage, promoteLatest } = require('./latest-image.cjs')

const commit = 'a'.repeat(40)
function fixture(version = '0.15.2', changes = {}) {
  const image = { ...imageMetadata(version, 'sha256:' + 'b'.repeat(64), commit), ...changes }
  const bytes = Buffer.from(JSON.stringify(image))
  const asset = { name: 'docker-image.json', state: 'uploaded', size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }
  return { image, bytes, release: { tag_name: `v${version}`, draft: false, prerelease: false, assets: [asset] } }
}

test('latest uses the immutable image from the published stable release', () => {
  const { release, bytes, image } = fixture()
  assert.deepEqual(verifyLatestImage(release, bytes, commit), image)
})

test('latest rejects missing releases, drafts, prereleases and malformed versions', () => {
  const { release } = fixture()
  for (const candidate of [null, { ...release, draft: true }, { ...release, prerelease: true }, { ...release, tag_name: 'v0.16.0-beta.1' }, { ...release, tag_name: 'latest' }, { ...release, tag_name: 'v../bad' }]) {
    assert.throws(() => releaseImageAsset(candidate))
  }
})

test('latest rejects incomplete, oversized and unverified release metadata', () => {
  const { release } = fixture()
  for (const changes of [{ state: 'new' }, { size: 0 }, { size: 16385 }, { digest: null }]) {
    assert.throws(() => releaseImageAsset({ ...release, assets: [{ ...release.assets[0], ...changes }] }), /verified Docker image metadata/)
  }
  assert.throws(() => releaseImageAsset({ ...release, assets: [] }), /verified Docker image metadata/)
})

test('latest rejects altered downloads and mismatched release tags or source commits', () => {
  const { release, bytes } = fixture()
  assert.throws(() => verifyLatestImage(release, Buffer.from('tampered'), commit), /checksum/)
  const altered = Buffer.from(bytes); altered[0] ^= 1
  assert.throws(() => verifyLatestImage(release, altered, commit), /checksum/)
  assert.throws(() => verifyLatestImage(release, bytes, 'c'.repeat(40)), /source tag/)
  assert.throws(() => verifyLatestImage(release, bytes, null), /verified digest and source commit/)
  for (const changes of [{ version: '0.15.1' }, { pinnedImage: 'ghcr.io/another/image:latest' }, { image: 'ghcr.io/amitai5/hidocknotes:0.15.1' }]) {
    const invalid = fixture('0.15.2', changes)
    assert.throws(() => verifyLatestImage(invalid.release, invalid.bytes, commit), /source tag/)
  }
})

test('a delayed workflow resolves the current stable release instead of its own version', async () => {
  const { release, bytes, image } = fixture('0.16.0')
  const calls = []
  const api = async endpoint => {
    if (endpoint === 'releases/latest') { return release }
    assert.equal(endpoint, 'git/ref/tags/v0.16.0')
    return { object: { type: 'commit', sha: commit } }
  }
  const fetchImpl = async url => {
    assert.equal(url, 'https://github.com/Amitai5/HiDockNotes/releases/download/v0.16.0/docker-image.json')
    return { ok: true, arrayBuffer: async () => bytes }
  }
  assert.deepEqual(await promoteLatest(api, 'Amitai5/HiDockNotes', fetchImpl, (...args) => calls.push(args)), image)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['docker', ['buildx', 'imagetools', 'create', '--prefer-index=false', '--tag', 'ghcr.io/amitai5/hidocknotes:latest', image.pinnedImage], { stdio: 'inherit' }])
})

test('failed or corrupted metadata downloads never change the registry tag', async () => {
  const { release } = fixture()
  const api = async endpoint => endpoint === 'releases/latest' ? release : { object: { type: 'commit', sha: commit } }
  let mutations = 0
  for (const response of [{ ok: false, status: 503 }, { ok: true, arrayBuffer: async () => Buffer.from('{}') }]) {
    await assert.rejects(promoteLatest(api, 'Amitai5/HiDockNotes', async () => response, () => mutations++))
  }
  assert.equal(mutations, 0)
})
