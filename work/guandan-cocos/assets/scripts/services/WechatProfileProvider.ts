import type { NativeScreenRect } from '../ui/WechatCapsuleLayout'

type ProfileResponse = { errMsg?: string, userInfo?: { nickName?: string, avatarUrl?: string } }
export type UserInfoButton = {
  onTap: (callback: (result: ProfileResponse) => void) => void
  offTap?: (callback: (result: ProfileResponse) => void) => void
  destroy: () => void
  hide?: () => void
  show?: () => void
}
export type WechatProfileApi = {
  requirePrivacyAuthorize?: (options: { success: () => void, fail: () => void }) => void
  createUserInfoButton?: (options: Record<string, unknown>) => UserInfoButton
}

/** Create only after an explicit in-game tap; never prompts during login/startup. */
export function mountWechatProfileButton (api: WechatProfileApi, rect: NativeScreenRect,
  accept: (profile: { displayName: string, avatarUrl: string }) => void, fail: (message: string) => void): () => void {
  let disposed = false
  let button: UserInfoButton | null = null
  let accepted = false
  const onTap = (result: ProfileResponse): void => {
    if (disposed || accepted) return
    const displayName = result.userInfo?.nickName?.trim() ?? ''
    const avatarUrl = result.userInfo?.avatarUrl?.trim() ?? ''
    if (!displayName || !/^https:\/\/thirdwx\.qlogo\.cn\//.test(avatarUrl) && !/^https:\/\/wx\.qlogo\.cn\//.test(avatarUrl)) {
      fail('未获取到微信资料，可再次授权或手动修改昵称')
      return
    }
    accepted = true
    accept({ displayName: Array.from(displayName).slice(0, 24).join(''), avatarUrl })
  }
  const create = (): void => {
    if (disposed || button) return
    try {
      if (!api.createUserInfoButton) { fail('当前微信版本不支持资料授权，请更新微信'); return }
      button = api.createUserInfoButton({ type: 'text', text: '授权使用微信昵称和头像', withCredentials: false, lang: 'zh_CN',
        style: { ...rect, lineHeight: rect.height, backgroundColor: '#287b58', color: '#ffffff', textAlign: 'center', fontSize: 16, borderRadius: 12 } })
      button.onTap(onTap)
    } catch { fail('微信授权暂不可用，请检查隐私保护指引配置') }
  }
  try {
    if (api.requirePrivacyAuthorize) api.requirePrivacyAuthorize({ success: create, fail: () => { if (!disposed) fail('未同意隐私授权，仍可手动修改昵称') } })
    else create()
  } catch { if (!disposed) fail('微信隐私授权暂不可用，请稍后重试') }
  return () => { disposed = true; button?.offTap?.(onTap); button?.hide?.(); button?.destroy(); button = null }
}
