/** Original procedural UI graphic, not an edit of any raster image. Reproducible RGBA PNG. */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const output = fileURLToPath(new URL('../assets/game-assets/effects/lobby-v1/', import.meta.url))
const cell = 48, width = cell * 8, height = cell * 2
const raw = Buffer.alloc((width * 4 + 1) * height)
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const frame = Math.floor(y / cell) * 8 + Math.floor(x / cell)
  const t = Math.sin(Math.PI * frame / 15)
  const dx = Math.abs(x % cell - 23.5), dy = Math.abs(y % cell - 23.5)
  const radius = 7 + 11 * t
  const core = Math.exp(-(dx * dx + dy * dy) / 9)
  const rays = Math.max(0, 1 - Math.min(dx + dy * 5, dy + dx * 5) / radius) ** 2
  const glow = .16 * Math.exp(-(dx * dx + dy * dy) / 45)
  const i = y * (width * 4 + 1) + 1 + x * 4
  raw[i] = 255; raw[i + 1] = 245; raw[i + 2] = 198
  raw[i + 3] = Math.round(Math.min(1, core + rays + glow) * 210 * t * t)
}
function crc32 (buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) { crc ^= byte; for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk (name, data) {
  const body = Buffer.concat([Buffer.from(name), data]), header = Buffer.alloc(4), crc = Buffer.alloc(4)
  header.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([header, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
mkdirSync(output, { recursive: true })
writeFileSync(output + 'button-glint.png', png)
console.log(`Original lobby glint: ${width} × ${height}, 16 frames, ${png.length} bytes, real alpha`)
