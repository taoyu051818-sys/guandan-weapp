export const FRIEND_SCORE_KEY = 'comprehensive_score_v1'
type Callbacks<T> = { success: (value: T) => void, fail: (error: unknown) => void }
export type FriendRankingApi = {
  getPrivacySetting?: (options: Callbacks<{ needAuthorization: boolean }>) => void
  requirePrivacyAuthorize?: (options: Callbacks<unknown>) => void
  getSetting?: (options: Callbacks<{ authSetting?: Record<string, boolean> }>) => void
  authorize?: (options: Callbacks<unknown> & { scope: string }) => void
  openSetting?: (options: Callbacks<unknown>) => void
  setUserCloudStorage?: (options: Callbacks<unknown> & { KVDataList: { key: string, value: string }[] }) => void
}
export function wechatRankingApi (): FriendRankingApi | undefined {
  return (globalThis as unknown as { wx?: FriendRankingApi }).wx
}
/** Only native callbacks are wrapped; never forwards friend records to the main domain. */
export function rankingCall<T> (invoke: (callbacks: Callbacks<T>) => void, timeout = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (error: unknown, value?: T): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (error) reject(new Error('微信服务暂时不可用，或权限未开启，请重试或检查权限设置。'))
      else resolve(value as T)
    }
    const timer = setTimeout(() => finish(new Error('timeout')), timeout)
    try { invoke({ success: value => finish(null, value), fail: error => finish(error || true) }) }
    catch (error) { finish(error) }
  })
}
const scope = 'scope.WxFriendInteraction'
export async function rankingAuthorized (api: FriendRankingApi): Promise<boolean> {
  if (!api.getPrivacySetting || !api.getSetting) return false
  const privacy = await rankingCall<{ needAuthorization: boolean }>(cb => api.getPrivacySetting!(cb))
  if (privacy.needAuthorization !== false) return false
  const setting = await rankingCall<{ authSetting?: Record<string, boolean> }>(cb => api.getSetting!(cb))
  return setting.authSetting?.[scope] === true
}
/** Called only after an explicit leaderboard button tap; silent publishing never prompts. */
export async function authorizeRanking (api: FriendRankingApi, current: () => boolean): Promise<void> {
  if (!api.getSetting || !api.authorize || !api.requirePrivacyAuthorize) throw new Error('请更新微信后使用好友排行。')
  await rankingCall(cb => api.requirePrivacyAuthorize!(cb))
  if (!current()) return
  const setting = await rankingCall<{ authSetting?: Record<string, boolean> }>(cb => api.getSetting!(cb))
  if (!current() || setting.authSetting?.[scope] === true) return
  await rankingCall(cb => api.authorize!({ ...cb, scope }))
}

/** Writes only our authenticated platform score, never synthetic friends or reward authority. */
export class WechatFriendScoreSync {
  private revision = 0
  private last = ''
  private tail: Promise<unknown> = Promise.resolve()
  public cancel (): void { this.revision++ }
  public publish (userId: string, score: number, silent = true, current: () => boolean = () => true): Promise<void> {
    const revision = this.revision
    const operation = async (): Promise<void> => {
      const api = wechatRankingApi()
      if (!current() || revision !== this.revision) return
      if (!api?.setUserCloudStorage || !userId || !Number.isFinite(score)) {
        if (!silent) throw new Error('综合分暂时无法同步，请更新微信或稍后重试。')
        return
      }
      const value = String(Math.round(score))
      const stamp = `${userId}:${value}`
      if (silent && stamp === this.last) return
      if (silent && !await rankingAuthorized(api)) return
      if (!current() || revision !== this.revision) return
      await rankingCall(cb => api.setUserCloudStorage!({ ...cb, KVDataList: [{ key: FRIEND_SCORE_KEY, value }] }))
      if (current() && revision === this.revision) this.last = stamp
    }
    const result = this.tail.then(operation, operation)
    this.tail = result.catch(() => {})
    return result
  }
}
