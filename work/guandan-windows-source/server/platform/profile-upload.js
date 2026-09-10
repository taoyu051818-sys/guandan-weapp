import { createHash } from 'node:crypto'
import { badRequest } from './errors.js'

const invalid = () => badRequest('INVALID_AVATAR_UPLOAD', '头像应为不超过64KB、256×256像素的PNG或JPEG图片')
export const isUploadedAvatar = value => typeof value === 'string' && /^upload:[a-f0-9]{64}$/.test(value)

/** Inspect dimensions before storage. Uploaded bytes are never served as executable/raw web content. */
export function validateAvatarUpload (dataUri) {
  if (typeof dataUri !== 'string' || dataUri.length > 88_000) throw invalid()
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUri)
  if (!match) throw invalid()
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length > 65536 || bytes.toString('base64') !== match[2]) throw invalid()
  let width = 0; let height = 0
  if (match[1] === 'png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(8) !== 13) throw invalid()
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20)
  } else {
    if (bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw invalid()
    let offset = 2
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 255) throw invalid()
      const marker = bytes[offset + 1]
      const length = bytes.readUInt16BE(offset + 2)
      if (length < 2 || offset + length + 2 > bytes.length) throw invalid()
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) throw invalid()
        height = bytes.readUInt16BE(offset + 5); width = bytes.readUInt16BE(offset + 7); break
      }
      if (marker === 0xda) break
      offset += length + 2
    }
  }
  if (width < 1 || height < 1 || width > 256 || height > 256) throw invalid()
  return { avatarUrl: `upload:${createHash('sha256').update(bytes).digest('hex')}`, dataUri }
}
