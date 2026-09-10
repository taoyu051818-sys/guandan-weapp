import { uiFrameRadius } from '../ui/UiFrameStyle'
import type { NativeScreenRect } from '../ui/WechatCapsuleLayout'
import { readWechatProfile, type WechatProfile, type WechatProfileResponse } from './WechatProfileResult'

export type UserInfoButton = {
  onTap: (callback: (result: WechatProfileResponse) => void) => void
  offTap?: (callback: (result: WechatProfileResponse) => void) => void
  destroy: () => void
  hide?: () => void
  show?: () => void
}
export type WechatProfileApi = {
  requirePrivacyAuthorize?: (options: { success: () => void, fail: () => void }) => void
  getSetting?: (options: { success: (result: { authSetting?: Record<string, boolean> }) => void, fail: () => void }) => void
  getPrivacySetting?: (options: { success: (result: { needAuthorization: boolean }) => void, fail: () => void }) => void
  getUserInfo?: (options: { withCredentials: boolean, lang: string, success: (result: WechatProfileResponse) => void, fail: () => void }) => void
  createUserInfoButton?: (options: Record<string, unknown>) => UserInfoButton
}
export type WechatProfileControl = (() => void) & { hide: () => void, show: () => void }

/** Called only after the player opens profile editing or explicitly retries; never at startup. */
export function mountWechatProfileButton (api: WechatProfileApi, rect: NativeScreenRect,
  accept: (profile: WechatProfile) => void, fail: (message: string) => void): WechatProfileControl {
  let disposed = false, accepted = false, hidden = false
  let button: UserInfoButton | null = null
  const destroyButton = (): void => {
    button?.offTap?.(onTap); button?.hide?.(); button?.destroy(); button = null
  }
  const onTap = (result: WechatProfileResponse): void => {
    if (disposed || accepted) return
    let profile: WechatProfile
    try { profile = readWechatProfile(result) } catch (error) { fail((error as Error).message); return }
    accepted = true
    destroyButton()
    accept(profile)
  }
  const create = (): void => {
    if (disposed || accepted || button) return
    try {
      if (!api.createUserInfoButton) { fail('当前微信版本不支持资料授权，请更新微信'); return }
      button = api.createUserInfoButton({ type: 'text', text: '授权使用微信昵称和头像', withCredentials: false, lang: 'zh_CN',
        style: { ...rect, lineHeight: rect.height, backgroundColor: '#287b58', color: '#ffffff', textAlign: 'center', fontSize: 16, borderRadius: uiFrameRadius(rect.width, rect.height, 'control') } })
      button.onTap(onTap)
      if (hidden) button.hide?.()
    } catch { fail('微信授权暂不可用，请检查隐私保护指引配置') }
  }
  // Mount the native touch target immediately. WeChat owns privacy/consent on this path;
  // do not gate creation behind an asynchronous privacy callback before the first tap.
  create()
  const dispose = (): void => {
    disposed = true
    destroyButton()
  }
  return Object.assign(dispose, {
    hide: () => { hidden = true; button?.hide?.() },
    show: () => { hidden = false; if (!disposed && !accepted) button?.show?.() },
  })
}
