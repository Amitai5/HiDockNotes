const product = require('./product.json')
const { writePolicy } = require('../../scripts/release/signing.cjs')
const policy = writePolicy(__dirname)
module.exports = {
  appId: product.appId,
  productName: product.name,
  directories: { output: `../../release/${product.version}` },
  files: ['out/**/*', 'package.json', 'resources/update-policy.json', ...['win32', 'darwin', 'linux'].filter(platform => platform !== process.platform).map(platform => `!node_modules/onnxruntime-node/bin/napi-v6/${platform}/**/*`)],
  extraResources: [{ from: '../../LICENSE', to: 'LICENSE' }, { from: '../../THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' }, { from: 'resources/icon.png', to: 'icon.png' }, { from: 'out/main/mcp-launcher.js', to: 'mcp-launcher.cjs' }],
  // SQLite and node-usb ship N-API binaries; use the verified installed binaries.
  npmRebuild: false,
  asarUnpack: ['**/*.node', '**/usb/**', '**/ffmpeg-static/**', '**/sherpa-onnx-*/**', '**/onnxruntime-node/**', '**/@img/**'],
  win: { icon: 'resources/icon.ico', target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'HiDockNotes-${version}-windows-${arch}-setup.${ext}', forceCodeSigning: policy.signed, verifyUpdateCodeSignature: true, ...(policy.signed ? { signtoolOptions: { publisherName: policy.publisher, signingHashAlgorithms: ['sha256'] } } : {}) },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, installerIcon: 'resources/icon.ico', uninstallerIcon: 'resources/icon.ico' },
  // Build on the Mac's own architecture so ffmpeg-static matches the target.
  mac: { icon: 'resources/icon.icns', target: policy.signed ? ['dmg', 'zip'] : ['dmg'], category: 'public.app-category.productivity', artifactName: 'HiDockNotes-${version}-macos-${arch}.${ext}', ...(policy.signed ? {} : { identity: '-' }), forceCodeSigning: policy.signed, hardenedRuntime: policy.signed, notarize: policy.signed },
  linux: { icon: 'resources/icon.png', target: [{ target: 'AppImage', arch: ['x64'] }, { target: 'deb', arch: ['x64'] }], category: 'Utility', artifactName: 'HiDockNotes-${version}-linux-x64.${ext}', maintainer: 'HiDockNotes contributors <Amitai5@users.noreply.github.com>' },
  publish: [{ provider: 'generic', url: 'https://github.com/Amitai5/HiDockNotes/releases/latest/download/', channel: 'latest' }]
}
