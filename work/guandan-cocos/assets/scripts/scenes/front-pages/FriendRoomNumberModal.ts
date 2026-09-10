import { BlockInputEvents, Color, EditBox, Node, Tween, UITransform, Vec3 } from 'cc'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { friendFormAction } from './FriendRoomFormUi'

/** A short room number is an entry request, never a game ticket or invitation token. */
export function showFriendRoomNumberModal (parent: Node, screen: ScreenAdapter, join: (roomId: string) => void): void {
  if (parent.getChildByName('FriendRoomNumberModal')) return
  const root = new Node('FriendRoomNumberModal')
  root.parent = parent
  const { width, height } = screen.viewport
  root.addComponent(UITransform).setContentSize(width, height)
  root.addComponent(BlockInputEvents)
  const ui = new RuntimeUiFactory(root)
  ui.panel('RoomNumberShade', 0, 0, width, height, { fill: new Color(2, 12, 14, 185), lineWidth: 0, frame: 'square' })
  const panel = ui.panel('RoomNumberPanel', 0, 0, 500, 290, {
    fill: new Color(26, 55, 43, 255), stroke: new Color(196, 175, 100), frame: 'panel',
  })
  const scale = Math.min(1, (screen.safeSize().x - 24) / 500, (screen.safeSize().y - 24) / 290)
  panel.setScale(new Vec3(scale, scale, 1))
  const body = new RuntimeUiFactory(panel)
  body.outlinedLabel('加入房间', 0, 104, 30, { width: 420, height: 40 })
  body.outlinedLabel('请输入好友的六位房间号', 0, 61, 21, { width: 440, height: 30 })
  const input = body.formInput('FriendRoomNumberInput', '六位数字房间号', 0, 9, {
    width: 410, height: 66, maxLength: 6, fontSize: 28, inputMode: EditBox.InputMode.NUMERIC,
  })
  const status = body.outlinedLabel('', 0, -40, 20, {
    width: 440, height: 30, color: new Color(255, 191, 162), outlineWidth: 0,
  })
  let closed = false
  const active = (): boolean => !closed && root.isValid && root.active && parent.isValid && parent.active
  const close = (): void => {
    if (!active()) return
    closed = true
    input.blur()
    input.enabled = false
    root.active = false
    const stop = (node: Node): void => { Tween.stopAllByTarget(node); node.children.forEach(stop) }
    stop(root)
    root.destroy()
  }
  const submit = (): void => {
    if (!active()) return
    const roomId = input.string.trim()
    if (!/^\d{6}$/.test(roomId)) { status.string = '请输入完整的六位数字房间号'; return }
    close()
    join(roomId)
  }
  input.node.on('text-changed', () => { if (active()) status.string = '' })
  input.node.on('editing-return', submit)
  friendFormAction(body, '取消', -112, -102, 194, 66, 23, new Color(52, 91, 74), close)
  friendFormAction(body, '加入', 112, -102, 194, 66, 23, new Color(224, 169, 54), submit)
}
