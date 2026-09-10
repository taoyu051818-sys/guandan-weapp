export type FriendInviteLaunch = { query?: Record<string, unknown> }
export type WechatFriendInviteApi = {
  shareAppMessage?: (options: { title: string, query: string, imageUrl: string }) => void
  getLaunchOptionsSync?: () => FriendInviteLaunch
  onShow?: (listener: (options: FriendInviteLaunch) => void) => void
  offShow?: (listener: (options: FriendInviteLaunch) => void) => void
}

/** Sharing carries only the room's invitation, never a user's signed entry/resume ticket. */
export const friendInviteQuery = (text: string): string | null => {
  const match = /^(\d{6})\.([A-Za-z0-9_-]{20,128})$/.exec(text.trim())
  return match ? `friendRoom=${match[1]}&friendInvite=${encodeURIComponent(match[2])}` : null
}

export const friendInviteFromLaunch = (launch: FriendInviteLaunch | undefined): string | null => {
  const room = launch?.query?.friendRoom
  const code = launch?.query?.friendInvite
  if (typeof room !== 'string' || typeof code !== 'string') return null
  const text = `${room}.${code}`
  return friendInviteQuery(text) ? text : null
}

/** Cold launch is deferred until the lobby is mounted; warm launch uses the same join flow. */
export class WechatFriendInvite {
  private pending: string | null = null
  private ready = false
  private disposed = false
  private readonly api: WechatFriendInviteApi | undefined

  constructor (private readonly enter: (text: string) => boolean | void, api = (globalThis as unknown as { wx?: WechatFriendInviteApi }).wx) {
    this.api = api
    try { this.pending = friendInviteFromLaunch(api?.getLaunchOptionsSync?.()) } catch { /* native bridge may not be ready */ }
    api?.onShow?.(this.onShow)
  }

  public activate (): void {
    this.ready = true
    this.consume()
  }

  public share (text: string | null): void {
    if (this.disposed) return
    const query = text && friendInviteQuery(text)
    if (!query) throw new Error('邀请暂不可用，请等待房间创建完成')
    if (!this.api?.shareAppMessage) throw new Error('请在微信小游戏内邀请好友')
    this.api.shareAppMessage({ title: '来一起掼蛋，点击加入我的好友房', query, imageUrl: 'friend-room-share.jpg' })
    // Opening the share sheet is not evidence that a message was sent.
  }

  public dispose (): void {
    this.disposed = true
    this.pending = null
    this.api?.offShow?.(this.onShow)
  }

  private readonly onShow = (launch: FriendInviteLaunch): void => {
    const text = friendInviteFromLaunch(launch)
    if (!text || this.disposed) return
    this.pending = text
    this.consume()
  }

  private consume (): void {
    if (!this.ready || this.disposed || !this.pending) return
    const text = this.pending
    this.pending = null
    if (this.enter(text) === false && !this.disposed && !this.pending) this.pending = text
  }
}
