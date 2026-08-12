import type { PlatformLoginCredential } from './platform/contracts'
import { PlatformApiError } from './platform/contracts'

export type WechatLoginApi = Readonly<{
  login: (options: {
    success: (result: { code?: string }) => void
    fail: (error?: { errMsg?: string }) => void
  }) => void
}>

/** Converts wx.login's callback API into a bounded, exactly-once credential provider. */
export function requestWechatLoginCredential (
  wxApi: WechatLoginApi | undefined,
  timeoutMs = 8_000,
): Promise<PlatformLoginCredential> {
  if (!wxApi?.login) {
    return Promise.reject(new PlatformApiError('请在微信环境登录，或仅在本地联调时开启开发登录', {
      code: 'WX_LOGIN_UNAVAILABLE',
      retryable: false,
    }))
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(watchdog)
      callback()
    }
    const watchdog = setTimeout(() => finish(() => reject(new PlatformApiError('微信登录响应超时，请稍后重试', {
      code: 'WX_LOGIN_TIMEOUT',
      retryable: true,
    }))), Math.max(1, timeoutMs))
    try {
      wxApi.login({
        success: result => finish(() => {
          const code = result.code?.trim()
          if (code) resolve({ kind: 'wechat', code })
          else reject(new PlatformApiError('微信登录没有返回有效凭证', { code: 'WX_LOGIN_INVALID_CODE', retryable: true }))
        }),
        fail: error => finish(() => reject(new PlatformApiError(error?.errMsg?.trim() || '微信登录失败，请稍后重试', {
          code: 'WX_LOGIN_FAILED',
          retryable: true,
        }))),
      })
    } catch (error) {
      finish(() => reject(new PlatformApiError(error instanceof Error ? error.message : '微信登录失败，请稍后重试', {
        code: 'WX_LOGIN_FAILED',
        details: error,
        retryable: true,
      })))
    }
  })
}
