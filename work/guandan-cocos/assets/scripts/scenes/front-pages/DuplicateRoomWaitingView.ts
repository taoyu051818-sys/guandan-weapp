import { Color, Node, Vec3 } from 'cc'
import type { LobbyController, LobbySnapshot } from '../../network/LobbyController'
import type { DuplicateSeat } from '../../network/DuplicateRoomModel'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { showFriendRoomRulesModal } from './FriendRoomRulesModal'
import { defaultProfileAsset } from '../../services/DefaultProfileFrames'

const RED = new Color(121, 42, 53, 225)
const BLUE = new Color(38, 69, 120, 225)
const GOLD = new Color(216, 166, 58)
const GREEN = new Color(46, 133, 91)
export const duplicateButton = (ui: RuntimeUiFactory, title: string, x: number, y: number, width: number, fill: Color, action?: () => void, height = 60): Node => {
  const n = ui.button('DuplicateButton', title, x, width, height, 23, { fill, disabled: !action,
    stroke: new Color(226, 214, 172), textColor: new Color(255, 247, 215), textOutlineColor: new Color(35, 40, 44), frame: 'control' })
  n.setPosition(new Vec3(x, y, 0)); if (action) n.on(Node.EventType.TOUCH_END, action)
  return n
}

/** Eight-seat ready page. No card data, platform requests or room mutation live here. */
export const renderDuplicateWaiting = (ui: RuntimeUiFactory, screen: ScreenAdapter, lobby: LobbyController,
  snapshot: LobbySnapshot, leave: () => void, invite?: () => void, avatar = 'ui/common/default-avatar/texture'): void => {
  const d = snapshot.duplicate!
  const width = screen.safeSize().x, height = screen.safeSize().y
  const cx = (screen.viewport.safeLeft - screen.viewport.safeRight) / 2
  const top = screen.safeTopY(42), bottom = screen.safeBottomY(52)
  ui.panel('DuplicateBackdrop', cx, 0, width, height, { fill: new Color(18, 37, 47, 246), lineWidth: 0 })
  duplicateButton(ui, '返回', screen.safeLeftX(68), top, 100, new Color(34, 62, 65), leave)
  ui.outlinedLabel(`复式私人房  ${snapshot.roomId}`, cx - 70, top, 30, { width: Math.min(520, width * 0.48), height: 48 })
  duplicateButton(ui, '规则', screen.safeLeftX(220), top, 100, new Color(34, 62, 65), () => showFriendRoomRulesModal(ui.parent, screen, 'duplicate'))
  ui.outlinedLabel(`${d.configuredRounds}局 · 同牌双桌 · 胜方3/2/1分，负方0分`, cx, top - 53, 21, { width: width * 0.75, height: 32 })
  const colWidth = Math.min(230, (width - 142) / 4), gutter = 12, middle = 98
  const left = cx - middle / 2 - colWidth * 1.5 - gutter
  const xs = [left, left + colWidth + gutter, cx + middle / 2 + colWidth / 2, cx + middle / 2 + colWidth * 1.5 + gutter]
  const rowH = Math.min(184, (height - 282) / 2)
  const rowYs = [top - 108 - rowH / 2, top - 116 - rowH * 1.5]
  const order: DuplicateSeat[][] = [['p1', 'p3', 'p2', 'p4'], ['p6', 'p8', 'p5', 'p7']]
  order.forEach((seats, row) => {
    const y = rowYs[row]
    ui.outlinedLabel(row ? 'B桌' : 'A桌', cx, y + 10, 28, { width: middle - 10, height: 42 })
    ui.outlinedLabel('VS', cx, y - 27, 26, { width: 70, height: 38, color: new Color(247, 211, 112) })
    seats.forEach((id, col) => {
      const s = d.slots.find(s => s.seat === id)!, x = xs[col], mine = id === d.mySeat
      ui.panel(`DuplicateSeat-${id}`, x, y, colWidth, rowH, { fill: s.team === 'red' ? RED : BLUE,
        stroke: mine ? new Color(255, 225, 122) : new Color(140, 160, 175), lineWidth: mine ? 3 : 1, frame: 'panel' })
      ui.outlinedLabel(`${s.team === 'red' ? '红队' : '蓝队'} · ${s.direction}${mine ? ' · 我' : ''}`, x, y + rowH / 2 - 23, 20, { width: colWidth - 12, height: 28 })
      if (s.occupied) {
        const face = ui.image(`DuplicateAvatar-${id}`, s.bot ? defaultProfileAsset(s.name) || avatar : avatar, x - colWidth / 2 + 46, y - 2, 62, 62)
        if (s.bot && snapshot.isRoomHost && !snapshot.gameStartPending) ui.makeInteractive(face, () => lobby.sendRoomIntent('removeBot', { duplicateSeat: id }), 0.96)
        ui.outlinedLabel(s.name, x + 34, y + 9, 21, { width: colWidth - 92, height: 32 })
        ui.outlinedLabel(s.host ? '房主' : s.bot ? '陪练' : '玩家', x + 34, y - 20, 18, { width: colWidth - 92, height: 26 })
        ui.outlinedLabel(s.online ? s.ready ? '已准备' : '未准备' : '已离线 · 保留席位', x, y - rowH / 2 + 20, 19, { width: colWidth - 12, height: 26,
          color: s.ready ? new Color(178, 245, 204) : new Color(245, 234, 206) })
      } else {
        const addBot = snapshot.isRoomHost && !snapshot.gameStartPending
          ? () => lobby.sendRoomIntent('addBot', { duplicateSeat: id }) : undefined
        duplicateButton(ui, '＋', x - colWidth / 2 + 46, y + 14, 62, new Color(35, 52, 68), addBot, 44).name = `DuplicateAdd-${id}`
        duplicateButton(ui, '坐下', x + 35, y + 14, colWidth - 108, GREEN,
          snapshot.gameStartPending ? undefined : () => lobby.sendRoomIntent('sitDown', { duplicateSeat: id }), 44).name = `DuplicateSit-${id}`
        duplicateButton(ui, '添加机器人', x, y - rowH / 2 + 26, colWidth - 24, GREEN, addBot, 44).name = `DuplicateAddBot-${id}`
      }
    })
  })
  const locked = Boolean(snapshot.gameStartPending)
  const actions = [
    { title: '邀请好友', fill: GREEN, action: invite },
    { title: d.mySeat ? '站起换座' : '观战位', fill: GREEN, action: d.mySeat ? () => lobby.sendRoomIntent('standUp') : undefined },
    { title: snapshot.isRoomHost && d.canStart ? '开始游戏' : d.ready ? '取消准备' : '准备', fill: GOLD,
      action: snapshot.isRoomHost && d.canStart ? () => lobby.startGame() : d.mySeat ? () => lobby.sendRoomIntent(d.ready ? 'cancelLobbyReady' : 'setLobbyReady') : undefined },
    ...(snapshot.isRoomHost ? [{ title: '补齐机器人', fill: GREEN, action: () => lobby.sendRoomIntent('fillBots') }] : []),
  ]
  const buttonW = Math.min(176, (width - 100) / actions.length - 16)
  actions.forEach((a, i) => duplicateButton(ui, locked ? '确认中…' : a.title, cx + (i - (actions.length - 1) / 2) * (buttonW + 16), bottom, buttonW, a.fill, locked ? undefined : a.action))
  ui.outlinedLabel(snapshot.error || (locked ? '平台确认开局，请稍候' : snapshot.isRoomHost
    ? '点空位下方“添加机器人”补位；八席准备后开始' : '房主可添加机器人；点“坐下”调整位置'), cx, bottom - 38, 19, { width: width - 40, height: 28 })
}
