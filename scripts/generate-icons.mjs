import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

// AudioLines geometry from lucide (ISC); attribution is in THIRD_PARTY_NOTICES.
// A small deterministic rasterizer avoids a production image-processing dependency.
const folder = resolve('apps/electron/resources')
mkdirSync(folder, { recursive: true })
const lines = [[2, 10, 13], [6, 6, 17], [10, 3, 21], [14, 8, 15], [18, 5, 18], [22, 10, 13]]
const crcTable = Array.from({ length: 256 }, (_, i) => { let value = i; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; return value >>> 0 })
function crc(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0 }
function chunk(type, bytes) { const data = Buffer.concat([Buffer.from(type), bytes]); const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(data)); return Buffer.concat([length, data, checksum]) }
function png(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size)
  const scale = size * 0.74 / 24, pad = size * 0.13
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let covered = 0
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4 - pad) / scale, py = (y + (sy + 0.5) / 4 - pad) / scale
      if (lines.some(([lx, start, end]) => Math.hypot(px - lx, py - Math.max(start, Math.min(end, py))) <= 1.1)) covered++
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4
    pixels[offset] = 164; pixels[offset + 1] = 151; pixels[offset + 2] = 243; pixels[offset + 3] = Math.round(covered / 16 * 255)
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map(png)
const icoHeader = Buffer.alloc(6); icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(images.length, 4)
let offset = 6 + images.length * 16
const entries = images.map((bytes, i) => { const entry = Buffer.alloc(16); entry[0] = sizes[i] === 256 ? 0 : sizes[i]; entry[1] = entry[0]; entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(bytes.length, 8); entry.writeUInt32LE(offset, 12); offset += bytes.length; return entry })
writeFileSync(resolve(folder, 'icon.ico'), Buffer.concat([icoHeader, ...entries, ...images]))
writeFileSync(resolve(folder, 'icon.png'), png(512))
const icnsImages = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([tag, size]) => { const bytes = png(size), header = Buffer.alloc(8); header.write(tag); header.writeUInt32BE(bytes.length + 8, 4); return Buffer.concat([header, bytes]) })
const icnsHeader = Buffer.alloc(8); icnsHeader.write('icns'); icnsHeader.writeUInt32BE(8 + icnsImages.reduce((sum, image) => sum + image.length, 0), 4)
writeFileSync(resolve(folder, 'icon.icns'), Buffer.concat([icnsHeader, ...icnsImages]))
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#a497f3" stroke-width="2.2" stroke-linecap="round">${lines.map(([x, start, end]) => `<path d="M${x} ${start}v${end - start}"/>`).join('')}</svg>`
writeFileSync(resolve(folder, 'icon.svg'), svg)
mkdirSync(resolve('apps/electron/public'), { recursive: true })
writeFileSync(resolve('apps/electron/public/voice.svg'), svg)
