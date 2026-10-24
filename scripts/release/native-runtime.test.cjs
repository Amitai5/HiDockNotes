const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { root } = require('./version.cjs')

const load = createRequire(path.join(root, 'packages/core/package.json'))
const searchLoad = createRequire(load.resolve('@huggingface/transformers'))
const runtime = path.dirname(searchLoad.resolve('onnxruntime-node/package.json'))
const version = searchLoad('onnxruntime-node/package.json').version

// Inspect the installed package, not a hardcoded version allowlist: a future
// dependency update must still supply native CPU binaries for the server runtime.
for (const [platform, arch, library] of [
  ['win32', 'x64', 'onnxruntime.dll'],
  ['linux', 'x64', 'libonnxruntime.so.1'],
  ['darwin', 'x64', `libonnxruntime.${version}.dylib`],
  ['darwin', 'arm64', `libonnxruntime.${version}.dylib`]
]) {
  test(`search runtime includes the ${platform}-${arch} binding and CPU library`, () => {
    for (const file of ['onnxruntime_binding.node', library]) {
      const target = path.join(runtime, 'bin/napi-v6', platform, arch, file)
      assert.ok(fs.existsSync(target), `The installed ONNX runtime ${version} is missing ${platform}/${arch}/${file}. Choose a runtime that supports every release target.`)
      assert.ok(fs.statSync(target).size > 0, `${target} is empty`)
    }
  })
}
