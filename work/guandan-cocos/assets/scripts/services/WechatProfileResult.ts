export type WechatProfileResponse = {
  errMsg?: string
  rawData?: string
  userInfo?: { nickName?: string, avatarUrl?: string }
}
export type WechatProfile = { displayName: string, avatarUrl: string }

/** Only display fields are accepted. Never forward encrypted data or platform identifiers. */
export function readWechatProfile (result: WechatProfileResponse): WechatProfile {
  if (result.errMsg && !/:ok$/.test(result.errMsg)) throw new Error(wechatProfileFailure(result.errMsg))
  let info = result.userInfo
  if (!info && typeof result.rawData === 'string' && result.rawData.length <= 16_384) {
    try { info = JSON.parse(result.rawData) as WechatProfileResponse['userInfo'] } catch { /* Report incomplete data below. */ }
  }
  const displayName = typeof info?.nickName === 'string' ? info.nickName.trim() : ''
  const avatarUrl = typeof info?.avatarUrl === 'string' ? info.avatarUrl.trim() : ''
  if (!displayName || /[\u0000-\u001f\u007f]/.test(displayName)
    || avatarUrl.length > 500 || !/^https:\/\/(?:thirdwx|wx)\.qlogo\.cn\/mmopen\/[^\s]+$/.test(avatarUrl)) {
    throw new Error('微信未返回完整昵称和头像，请重新授权；仍可手动修改昵称')
  }
  return { displayName: Array.from(displayName).slice(0, 24).join(''), avatarUrl }
}

export function wechatProfileFailure (message = ''): string {
  if (/scope is not declared|announce your privacy usage/i.test(message)) return '请在微信公众平台隐私保护指引中声明“昵称、头像”后重新测试'
  if (/implement the privacy pop-up/i.test(message)) return '请在微信公众平台开启隐私授权弹窗，或完成自定义隐私授权接入'
  if (/privacy|隐私/i.test(message)) return '微信隐私授权未完成，请重试；若持续失败请核对后台隐私保护指引'
  if (/deny|denied|cancel|auth deny/i.test(message)) return '已取消微信资料授权，可重试或手动修改昵称'
  return '微信资料获取失败，请重试或手动修改昵称'
}
