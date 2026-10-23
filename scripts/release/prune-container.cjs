const fs = require('node:fs')
const path = require('node:path')
function removeChild(root, name) {
  const parent = path.resolve(root), target = path.resolve(parent, name)
  if (path.dirname(target) !== parent || target === parent) throw new Error('Refusing to remove a path outside the native runtime directory.')
  fs.rmSync(target, { recursive: true, force: true })
}
function pruneRuntime(root, platform, architecture) {
  for (const name of ['linux', 'darwin', 'win32']) if (name !== platform) removeChild(root, name)
  for (const name of ['x64', 'arm64']) if (name !== architecture) removeChild(path.join(root, platform), name)
}
if (require.main === module) {
  if (process.platform !== 'linux') throw new Error('Container runtime pruning is only intended for Linux image builds.')
  const runtime = path.join(path.dirname(require.resolve('onnxruntime-node/package.json')), 'bin', 'napi-v6')
  pruneRuntime(runtime, process.platform, process.arch)
}
module.exports = { removeChild, pruneRuntime }
