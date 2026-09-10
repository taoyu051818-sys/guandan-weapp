import { Color, Node } from 'cc'
import type { LobbyController, LobbySnapshot } from '../network/LobbyController'
import type { ScreenAdapter } from '../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../ui/RuntimeUiFactory'
import { duplicateButton } from './front-pages/DuplicateRoomWaitingView'

const signatures = new WeakMap<Node, string>()
export const renderDuplicateTableStatus = (parent: Node, screen: ScreenAdapter, lobby: LobbyController, snapshot: LobbySnapshot): void => {
  const d = snapshot.duplicate
  const signature = JSON.stringify(d)
  if (signatures.get(parent) === signature) return
  signatures.set(parent, signature)
  parent.getChildByName('DuplicateTableStatus')?.destroy()
  if (!d || d.phase !== 'playing') return
  const home = d.slots.find(s => s.seat === d.mySeat)?.table ?? 'A'
  if (d.mySeat && d.tables[home] !== 'settled') return
  const root = new Node('DuplicateTableStatus'); parent.addChild(root)
  const ui = new RuntimeUiFactory(root), watching = Boolean(d.watching)
  duplicateButton(ui, watching ? '返回本桌' : '查看另一桌', screen.safeRightX(140), screen.safeBottomY(144), 204, new Color(43, 119, 105),
    () => lobby.sendRoomIntent('watchTable', { table: watching ? null : home === 'A' ? 'B' : 'A' }))
  ui.outlinedLabel(watching ? '只读观看 · 不能操作另一桌手牌' : '本桌已结束 · 等待两桌完成后继续', 0, screen.safeTopY(100), 20, { width: 680, height: 32 })
}
