import type { LobbyServiceId } from '../../ui/LobbyServicePolicy'
import type { WechatFriendInviteApi } from '../../services/WechatFriendInvite'
import type { ServiceId, ServiceNotice } from '../../services/OperationsGatewayContracts'

export type LobbyServiceActions = {
  showTasks: () => void, showRecords: () => void, showRanking: () => void,
  showMessages: () => void, showFeedback: () => void,
  showNotice: (title: string, detail?: string) => void,
  loadNotice: (id: ServiceId) => Promise<ServiceNotice>,
  context: () => number | string | null,
}
const pending = new WeakSet<LobbyServiceActions>()

/** Check server availability on every click; membership remains a notice-only entry. */
export async function openLobbyService (id: LobbyServiceId, actions: LobbyServiceActions,
  api = (globalThis as unknown as { wx?: WechatFriendInviteApi }).wx): Promise<void> {
  if (id === 'tasks') return actions.showTasks()
  if (id === 'records') return actions.showRecords()
  if (id === 'ranking') return actions.showRanking()
  if (id === 'share') {
    if (!api?.shareAppMessage) return actions.showNotice('请在微信小游戏内分享', '好友收到游戏卡片后可进入大厅；邀请加入房间请使用牌桌里的“邀请好友”。')
    try { api.shareAppMessage({ title: '来一起玩掼蛋，好友同桌更尽兴', query: '', imageUrl: 'friend-room-share.jpg' }) }
    catch { actions.showNotice('暂时无法打开分享', '请稍后重试。') }
    return
  }
  const context = actions.context()
  if (context === null || pending.has(actions)) return
  pending.add(actions)
  try {
    const notice = await actions.loadNotice(id)
    if (actions.context() !== context) return
    if (notice.status === 'open' && id === 'messages') actions.showMessages()
    else if (notice.status === 'open' && id === 'feedback') actions.showFeedback()
    else actions.showNotice(notice.title, notice.detail)
  } catch (error) {
    if (actions.context() === context) actions.showNotice('暂时无法获取服务信息', error instanceof Error ? error.message : '请稍后重试。')
  } finally { pending.delete(actions) }
}
