const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const manifestPaths = ['package.json', 'apps/electron/package.json', 'apps/electron/product.json', 'package-lock.json']

function assertVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
    throw new Error('Use a version such as 0.9.4 or 0.9.4-beta.1 (without a v prefix or build metadata).')
  }
  const prerelease = version.split('-').slice(1).join('-')
  if (prerelease.split('.').some(part => /^0\d+$/.test(part))) {
    throw new Error('Numeric prerelease identifiers must not have leading zeroes.')
  }
  return version
}

function validateManifests(manifests) {
  const version = assertVersion(manifests['apps/electron/product.json'].version)
  const entries = [
    ...manifestPaths.map(file => [file, manifests[file].version]),
    ['package-lock.json packages[""]', manifests['package-lock.json'].packages?.['']?.version],
    ['package-lock.json packages["apps/electron"]', manifests['package-lock.json'].packages?.['apps/electron']?.version]
  ]
  for (const [file, value] of entries) {
    if (value !== version) { throw new Error(`${file} has version ${value}; expected ${version}. Run npm run release:version -- ${version}.`) }
  }
  return version
}

function readManifests(directory = root) {
  return Object.fromEntries(manifestPaths.map(file => [file, JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))]))
}

function readVersion(directory = root) {
  return validateManifests(readManifests(directory))
}

function setVersion(manifests, version) {
  assertVersion(version)
  for (const file of manifestPaths) { manifests[file].version = version }
  manifests['package-lock.json'].packages[''].version = version
  manifests['package-lock.json'].packages['apps/electron'].version = version
  return manifests
}

if (require.main === module) {
  try {
    if (process.argv[2]) {
      const manifests = setVersion(readManifests(), process.argv[2])
      validateManifests(manifests)
      for (const file of manifestPaths) { fs.writeFileSync(path.join(root, file), `${JSON.stringify(manifests[file], null, 2)}\n`) }
    }
    console.log(`HiDockNotes version ${readVersion()}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}

module.exports = { root, assertVersion, validateManifests, readVersion, setVersion }
