import { badRequest, serviceUnavailable } from './errors.js'

const allowedHosts = new Set(['thirdwx.qlogo.cn', 'wx.qlogo.cn'])
const allowedAssets = new Set(['asset:ui/common/default-avatar/texture', 'asset:ui/lobby/shop-float-chick/texture'])
const maxBytes = 512 * 1024
const cache = new Map()

export function validateProfilePatch (body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('INVALID_PROFILE', '资料格式不正确')
  if (body.displayName !== undefined && (typeof body.displayName !== 'string' || !body.displayName.trim()
    || Array.from(body.displayName.trim()).length > 24 || /[\u0000-\u001f\u007f]/.test(body.displayName))) {
    throw badRequest('INVALID_NICKNAME', '昵称应为1—24字，不含换行或控制字符')
  }
  if (body.avatarUrl !== undefined && body.avatarUrl !== '' && !allowedAssets.has(body.avatarUrl)) validateAvatarUrl(body.avatarUrl)
}

function validateAvatarUrl (value) {
  let url
  try { url = new URL(value) } catch { throw badRequest('INVALID_AVATAR', '请选择默认头像或授权微信头像') }
  if (typeof value !== 'string' || value.length > 500 || url.protocol !== 'https:' || !allowedHosts.has(url.hostname)
    || url.port || url.username || url.password || !url.pathname.startsWith('/mmopen/')) {
    throw badRequest('INVALID_AVATAR', '请选择默认头像或授权微信头像')
  }
  return url.href
}

/** Authenticated own-avatar proxy: no arbitrary URL query, redirects, cookies or file paths. */
export async function readProfileAvatar (avatarUrl, fetchImage = fetch) {
  if (!avatarUrl || allowedAssets.has(avatarUrl)) return null
  const url = validateAvatarUrl(avatarUrl)
  const existing = cache.get(url)
  if (fetchImage === fetch && existing && existing.expiresAt > Date.now()) return existing.dataUri
  try {
    const response = await fetchImage(url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { accept: 'image/png,image/jpeg' } })
    if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > maxBytes) throw new Error('image unavailable')
    const chunks = []
    let size = 0
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > maxBytes) throw new Error('image too large')
      chunks.push(Buffer.from(chunk))
    }
    const bytes = Buffer.concat(chunks)
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    if (!png && !jpeg) throw new Error('invalid image signature')
    const dataUri = `data:image/${png ? 'png' : 'jpeg'};base64,${bytes.toString('base64')}`
    if (fetchImage === fetch) {
      if (cache.size >= 20) cache.delete(cache.keys().next().value)
      cache.set(url, { dataUri, expiresAt: Date.now() + 600_000 })
    }
    return dataUri
  } catch { throw serviceUnavailable('AVATAR_UNAVAILABLE', '微信头像暂时无法加载，请稍后重试') }
}
