const { execFileSync } = require('node:child_process')
const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const electron = require('electron')

// Use the existing Electron image codec for packaging, without adding an image
// dependency. The generated master remains the source of every platform size.
if (typeof electron === 'string') {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  try { execFileSync(electron, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true, env: environment }) }
  catch (error) { process.exitCode = error.status || 1 }
} else {
  const { app, nativeImage } = electron
  app.disableHardwareAcceleration()
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'hidocknotes-icon-tool-')))
  void app.whenReady().then(() => {
    const root = resolve(__dirname, '..'), resources = join(root, 'apps/electron/resources')
    const source = join(resources, 'branding/hidocknotes-icon.png')
    const image = nativeImage.createFromPath(source), size = image.getSize()
    if (image.isEmpty() || size.width !== size.height || size.width < 512) throw new Error('The master icon must be a square PNG of at least 512 pixels.')
    const force = process.argv.includes('--force')
    const targets = [join(resources, 'icon.png'), join(resources, 'icon.ico'), join(resources, 'icon.icns'), join(root, 'apps/electron/public/app-icon.png'), join(root, 'apps/electron/src/assets/brand-mark.png')]
    if (!force && targets.some(existsSync)) throw new Error('Icon output already exists. Use --force to regenerate the app assets.')
    const png = pixels => image.resize({ width: pixels, height: pixels, quality: 'best' }).toPNG()
    const sizes = [16, 24, 32, 48, 64, 128, 256], images = sizes.map(png)
    const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4)
    let offset = 6 + images.length * 16
    const entries = images.map((bytes, index) => {
      const entry = Buffer.alloc(16)
      entry[0] = sizes[index] === 256 ? 0 : sizes[index]; entry[1] = entry[0]
      entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(bytes.length, 8); entry.writeUInt32LE(offset, 12)
      offset += bytes.length; return entry
    })
    const macSizes = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
    const macImages = macSizes.map(([tag, pixels]) => {
      const bytes = png(pixels), entry = Buffer.alloc(8)
      entry.write(tag); entry.writeUInt32BE(bytes.length + 8, 4)
      return Buffer.concat([entry, bytes])
    })
    const macHeader = Buffer.alloc(8); macHeader.write('icns'); macHeader.writeUInt32BE(8 + macImages.reduce((sum, bytes) => sum + bytes.length, 0), 4)
    const outputs = [png(1024), Buffer.concat([header, ...entries, ...images]), Buffer.concat([macHeader, ...macImages]), png(64), png(256)]
    targets.forEach((target, index) => { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, outputs[index], { flag: force ? 'w' : 'wx' }); console.log(target) })
    app.quit()
  }).catch(error => { console.error(error.message); app.exit(1) })
}
