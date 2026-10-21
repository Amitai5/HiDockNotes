const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { root, readVersion, assertVersion } = require('./version.cjs')

function expectedArtifacts(version, signed = false) {
  assertVersion(version)
  const files = {
    'windows-x64': [`HiDockNotes-${version}-windows-x64-setup.exe`],
    'linux-x64': [`HiDockNotes-${version}-linux-x64.AppImage`, `HiDockNotes-${version}-linux-x64.deb`],
    'macos-x64': [`HiDockNotes-${version}-macos-x64.dmg`],
    'macos-arm64': [`HiDockNotes-${version}-macos-arm64.dmg`]
  }
  if (signed) {
    files['windows-x64'].push('latest.yml')
    files['linux-x64'].push('latest-linux.yml')
    files['macos-x64'].push(`HiDockNotes-${version}-macos-x64.zip`, 'latest-x64-mac.yml')
    files['macos-arm64'].push(`HiDockNotes-${version}-macos-arm64.zip`, 'latest-arm64-mac.yml')
  }
  return files
}

function assertArtifact(file) {
  const info = fs.lstatSync(file)
  if (!info.isFile() || info.size === 0) { throw new Error(`Missing or invalid installer: ${path.basename(file)}`) }
}

function collect(platform) {
  const version = readVersion()
  const signed = process.env.HIDOCKNOTES_SIGNED_RELEASE === 'true'
  const expected = expectedArtifacts(version, signed)[platform]
  if (!expected) { throw new Error(`Unsupported release platform: ${platform}`) }
  const directory = path.join(root, 'release', version)
  const destination = path.join(directory, 'assets', platform)
  const sourceName = name => /^latest-(x64|arm64)-mac\.yml$/.test(name) ? 'latest-mac.yml' : name
  for (const file of expected) { assertArtifact(path.join(directory, sourceName(file))) }
  fs.mkdirSync(destination, { recursive: true })
  for (const file of expected) { fs.copyFileSync(path.join(directory, sourceName(file)), path.join(destination, file)) }
  console.log(`Collected ${expected.length} installer(s) for ${platform}.`)
}

async function checksum(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk) }
  return hash.digest('hex')
}

async function verifyArtifacts(directory, version, signed = false) {
  const expected = Object.values(expectedArtifacts(version, signed)).flat().sort()
  const actual = fs.readdirSync(directory).filter(name => name !== 'SHA256SUMS.txt' && !(signed && ['updates.json', 'updates.json.sig'].includes(name))).sort()
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
