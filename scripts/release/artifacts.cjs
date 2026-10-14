const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { root, readVersion, assertVersion } = require('./version.cjs')

function expectedArtifacts(version) {
  assertVersion(version)
  return {
    'windows-x64': [`HiDockNotes-${version}-windows-x64-setup.exe`],
    'linux-x64': [`HiDockNotes-${version}-linux-x64.AppImage`, `HiDockNotes-${version}-linux-x64.deb`],
    'macos-x64': [`HiDockNotes-${version}-macos-x64.dmg`],
    'macos-arm64': [`HiDockNotes-${version}-macos-arm64.dmg`]
  }
}

function assertArtifact(file) {
  const info = fs.lstatSync(file)
  if (!info.isFile() || info.size === 0) { throw new Error(`Missing or invalid installer: ${path.basename(file)}`) }
}

function collect(platform) {
  const version = readVersion()
  const expected = expectedArtifacts(version)[platform]
  if (!expected) { throw new Error(`Unsupported release platform: ${platform}`) }
  const directory = path.join(root, 'release', version)
  const destination = path.join(directory, 'assets', platform)
  for (const file of expected) { assertArtifact(path.join(directory, file)) }
  fs.mkdirSync(destination, { recursive: true })
  for (const file of expected) { fs.copyFileSync(path.join(directory, file), path.join(destination, file)) }
  console.log(`Collected ${expected.length} installer(s) for ${platform}.`)
}

async function checksum(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk) }
  return hash.digest('hex')
}

async function verifyArtifacts(directory, version) {
  const expected = Object.values(expectedArtifacts(version)).flat().sort()
  const actual = fs.readdirSync(directory).filter(name => name !== 'SHA256SUMS.txt').sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) { throw new Error('Release must contain exactly the Windows, Linux AppImage/deb, Intel Mac and Apple Silicon Mac installers.') }
  const artifacts = []
  for (const name of expected) {
    const file = path.join(directory, name)
    assertArtifact(file)
    artifacts.push({ name, size: fs.statSync(file).size, sha256: await checksum(file) })
  }
  return artifacts
}

if (require.main === module) {
  try { collect(process.argv[2]) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { expectedArtifacts, verifyArtifacts, checksum }
