const fs = require('node:fs')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { isDeepStrictEqual } = require('node:util')
const { assertVersion } = require('./version.cjs')
const { githubClient, tagCommit } = require('./github.cjs')
const { imageMetadata } = require('./hosted.cjs')

function releaseImageAsset(release) {
  if (!release || release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' || !release.tag_name.startsWith('v')) {
    throw new Error('The latest image must come from a published stable release.')
  }
  const version = assertVersion(release.tag_name.slice(1))
  if (version.includes('-')) { throw new Error('Prerelease images cannot become latest.') }
  const asset = release.assets?.find(item => item.name === 'docker-image.json')
  if (!asset || asset.state !== 'uploaded' || !Number.isInteger(asset.size) || asset.size <= 0 || asset.size > 16384 || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) {
    throw new Error('The published release must contain verified Docker image metadata.')
  }
  return asset
}

function verifyLatestImage(release, bytes, commit) {
  const asset = releaseImageAsset(release)
  if (bytes.length !== asset.size || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== asset.digest) {
    throw new Error('Downloaded Docker image metadata does not match its published checksum.')
  }
  const image = JSON.parse(bytes.toString('utf8'))
  const expected = imageMetadata(release.tag_name.slice(1), image.digest, commit)
  if (!isDeepStrictEqual(image, expected)) { throw new Error('Docker image metadata does not match the published release and source tag.') }
  return expected
}

async function promoteLatest(api, repository, fetchImpl = fetch, run = execFileSync) {
  // Resolve the current stable release after acquiring the workflow's shared lock.
  // A delayed or retried older run must never promote its own older version.
  const release = await api('releases/latest')
  releaseImageAsset(release)
  const response = await fetchImpl(`https://github.com/${repository}/releases/download/${release.tag_name}/docker-image.json`, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) { throw new Error(`Could not download released Docker image metadata (HTTP ${response.status}).`) }
  const bytes = Buffer.from(await response.arrayBuffer())
  const image = verifyLatestImage(release, bytes, await tagCommit(api, release.tag_name))
  const target = 'ghcr.io/amitai5/hidocknotes:latest'
  run('docker', ['buildx', 'imagetools', 'create', '--prefer-index=false', '--tag', target, image.pinnedImage], { stdio: 'inherit' })
  return image
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/production') { throw new Error('The latest image must be promoted from production.') }
  const image = await promoteLatest(githubClient(), process.env.GITHUB_REPOSITORY)
  console.log(`Published ghcr.io/amitai5/hidocknotes:latest from stable release ${image.version} (${image.digest}).`)
  if (process.env.GITHUB_STEP_SUMMARY) { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Docker \`latest\` now tracks stable release **${image.version}**, pinned to \`${image.digest}\`.\n`) }
}

if (require.main === module) { main().catch(error => { console.error(error.message); process.exitCode = 1 }) }
module.exports = { releaseImageAsset, verifyLatestImage, promoteLatest }
