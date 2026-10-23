const fs = require('node:fs')
const path = require('node:path')
const { root, assertVersion } = require('./version.cjs')
const hostedManifests = ['apps/web/package.json', 'apps/web/product.json', 'apps/server/package.json', 'apps/server/product.json', 'packages/core/package.json']
function checkHosted(directory = root, update = false) {
  const version = assertVersion(JSON.parse(fs.readFileSync(path.join(directory, 'package.json'))).version)
  const lockFile = path.join(directory, 'package-lock.json'), lock = JSON.parse(fs.readFileSync(lockFile))
  for (const name of hostedManifests) {
    const file = path.join(directory, name), value = JSON.parse(fs.readFileSync(file))
    if (update) { value.version = version; fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); if (name.endsWith('package.json')) lock.packages[path.dirname(name)].version = version }
    else if (value.version !== version || name.endsWith('package.json') && lock.packages[path.dirname(name)]?.version !== version) throw new Error(`${name} must match version ${version}. Run npm run release:version -- ${version}.`)
  }
  if (update) fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + '\n')
  return version
}
function imageMetadata(version, digest, commit) {
  assertVersion(version)
  if (!/^sha256:[a-f0-9]{64}$/.test(digest) || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('A release image must have a verified digest and source commit.')
  return { format: 1, version, image: 'ghcr.io/amitai5/hidocknotes:' + version, digest, pinnedImage: 'ghcr.io/amitai5/hidocknotes@' + digest, commit, platform: 'linux/amd64' }
}
if (require.main === module) {
  try {
    if (process.argv[2] === 'metadata') { const directory = path.join(root, 'release', 'hosted'); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, 'docker-image.json'), JSON.stringify(imageMetadata(checkHosted(), process.env.IMAGE_DIGEST, process.env.RELEASE_COMMIT), null, 2) + '\n'); fs.copyFileSync(path.join(root, 'compose.yaml'), path.join(directory, 'compose.yaml')) }
    else console.log('Hosted version ' + checkHosted(root, process.argv.includes('--update')))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { checkHosted, imageMetadata }
