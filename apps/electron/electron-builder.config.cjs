const product = require('./product.json')
module.exports = {
  appId: product.appId,
  productName: product.name,
  directories: { output: `../../release/${product.version}` },
  files: ['out/**/*', 'package.json'],
  extraResources: [{ from: '../../LICENSE', to: 'LICENSE' }, { from: '../../THIRD_PARTY_NOTICES.md', to: 'THIRD_PARTY_NOTICES.md' }, { from: 'resources/icon.png', to: 'icon.png' }, { from: 'out/main/mcp-launcher.js', to: 'mcp-launcher.cjs' }],
  // SQLite and node-usb ship N-API binaries; use the verified installed binaries.
  npmRebuild: false,
  asarUnpack: ['**/*.node', '**/usb/**', '**/ffmpeg-static/**', '**/sherpa-onnx-*/**'],
  win: { icon: 'resources/icon.ico', target: [{ target: 'nsis', arch: ['x64'] }] },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, installerIcon: 'resources/icon.ico', uninstallerIcon: 'resources/icon.ico' },
  // Build on the Mac's own architecture so ffmpeg-static matches the target.
  mac: { icon: 'resources/icon.icns', target: ['dmg'], category: 'public.app-category.productivity' },
  publish: null
}
