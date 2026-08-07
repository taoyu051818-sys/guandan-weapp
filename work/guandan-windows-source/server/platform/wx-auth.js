import { badRequest, serviceUnavailable, unauthorized } from './errors.js'

export class WxCodeVerifier {
  constructor ({ appId, secret, fetchImpl = globalThis.fetch, timeoutMs = 5000 }) {
    this.appId = appId
    this.secret = secret
    this.fetchImpl = fetchImpl
    this.timeoutMs = timeoutMs
  }

  async verify (code) {
    const safeCode = typeof code === 'string' ? code.trim() : ''
    if (!safeCode || safeCode.length > 256) throw badRequest('WX_CODE_REQUIRED', '微信登录 code 无效')
    if (!this.appId || !this.secret) throw serviceUnavailable('WX_LOGIN_NOT_CONFIGURED', '微信登录尚未配置')
    const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
    url.search = new URLSearchParams({
      appid: this.appId,
      secret: this.secret,
      js_code: safeCode,
      grant_type: 'authorization_code',
    }).toString()
    let response
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) })
    } catch {
      throw serviceUnavailable('WX_LOGIN_UNAVAILABLE', '微信登录服务暂时不可用')
    }
    if (!response.ok) throw serviceUnavailable('WX_LOGIN_UNAVAILABLE', '微信登录服务暂时不可用')
    let payload
    try { payload = await response.json() } catch { throw serviceUnavailable('WX_LOGIN_INVALID_RESPONSE', '微信登录服务返回异常') }
    if (payload.errcode || typeof payload.openid !== 'string' || !payload.openid) {
      throw unauthorized('微信登录凭证无效或已过期')
    }
    // session_key 只用于后续需要时的服务端解密，本项目当前不落库、不返回客户端。
    return { externalId: `wx:${this.appId}:${payload.openid}` }
  }
}

