const { test } = require('node:test')
const assert = require('node:assert/strict')
const { imageMetadata, checkHosted, deploymentVersion } = require('./hosted.cjs')
test('hosted manifests and lockfile match the release', () => { assert.match(checkHosted(), /^\d+\.\d+\.\d+/) })
test('container metadata pins a verified image and source commit', () => { const value = imageMetadata('0.15.0', 'sha256:' + 'a'.repeat(64), 'b'.repeat(40)); assert.equal(value.image, 'ghcr.io/amitai5/hidocknotes:0.15.0'); assert.equal(value.pinnedImage, 'ghcr.io/amitai5/hidocknotes@sha256:' + 'a'.repeat(64)) })
test('container metadata rejects unsafe tags and missing image digests', () => { assert.throws(() => imageMetadata('../latest', '', '')); assert.throws(() => imageMetadata('0.15.0', 'latest', 'b'.repeat(40))) })

test('version updates keep the Compose and environment defaults on the new image', () => {
  assert.equal(deploymentVersion('compose.yaml', 'image: ghcr.io/amitai5/hidocknotes:${HIDOCKNOTES_VERSION:-0.15.0}\n', '0.15.1'), 'image: ghcr.io/amitai5/hidocknotes:${HIDOCKNOTES_VERSION:-0.15.1}\n')
  assert.equal(deploymentVersion('.env.example', 'HIDOCKNOTES_VERSION=0.15.0\r\nAPP_ORIGIN=https://notes.example.com\r\n', '0.15.1'), 'HIDOCKNOTES_VERSION=0.15.1\r\nAPP_ORIGIN=https://notes.example.com\r\n')
})

test('deployment version updates reject missing pins and invalid version values', () => {
  assert.throws(() => deploymentVersion('compose.yaml', 'image: ghcr.io/amitai5/hidocknotes:latest', '0.15.1'), /pinned deployment version/)
  assert.throws(() => deploymentVersion('.env.example', 'HIDOCKNOTES_VERSION=0.15.0', '../bad'), /Use a version/)
})
