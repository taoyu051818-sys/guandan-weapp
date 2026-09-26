import { LOBBY_BOTTOM_DOCK as DOCK, type LobbyLayout } from './LobbyLayoutPolicy'
import { avoidNativeCapsule, type SceneExclusionRect } from './WechatCapsuleLayout'

export type LobbyServiceId = 'messages' | 'share' | 'feedback' | 'tasks' | 'records' | 'ranking' | 'membership'
const dockX = (index: number) => DOCK.left + DOCK.shopSize + DOCK.gap + DOCK.serviceWidth / 2
  + index * (DOCK.serviceWidth + DOCK.gap)
export const LOBBY_SERVICES: ReadonlyArray<Readonly<{
  id: LobbyServiceId, label: string, row: 'top' | 'bottom', x: number,
}>> = Object.freeze([
  { id: 'messages', label: '消息', row: 'top', x: 518 },
  { id: 'share', label: '分享', row: 'top', x: 580 },
  { id: 'feedback', label: '反馈', row: 'top', x: 642 },
  { id: 'tasks', label: '任务', row: 'bottom', x: dockX(0) },
  { id: 'records', label: '我的对局', row: 'bottom', x: dockX(1) },
  { id: 'ranking', label: '排行榜', row: 'bottom', x: dockX(2) },
  { id: 'membership', label: '会员', row: 'bottom', x: dockX(3) },
])

/** Move the upper row as one group, preserving spacing around native WeChat chrome. */
export function lobbyServiceRects (layout: LobbyLayout, capsule?: SceneExclusionRect) {
  const s = layout.scale
  const center = layout.point(580, 38)
  const safe = avoidNativeCapsule(center, 180 * s, 56 * s, capsule, layout.point(200, 0).x)
  return LOBBY_SERVICES.map(service => {
    const top = service.row === 'top'
    const p = layout.point(service.x, top ? 38 : DOCK.bottom - DOCK.serviceHeight / 2)
    return { ...service, x: p.x + (top ? safe.x - center.x : 0), y: p.y + (top ? safe.y - center.y : 0),
      width: (top ? 56 : DOCK.serviceWidth) * s, height: (top ? 56 : DOCK.serviceHeight) * s }
  })
}
