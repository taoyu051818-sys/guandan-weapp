import { Color, Mask, Node, ScrollView, UITransform, Vec3 } from 'cc'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'

/** Keep the secondary join and primary create actions in one responsive footer. */
export const friendRoomEntryActions = (ui: RuntimeUiFactory, x: number, y: number, width: number, join: () => void, create: () => void): void => {
  const actionWidth = Math.min(240, (width - 36) / 2)
  friendFormAction(ui, '加入房间', x - actionWidth / 2 - 9, y, actionWidth, 52, 22, new Color(44, 132, 77), join)
  friendFormAction(ui, '创建房间', x + actionWidth / 2 + 9, y, actionWidth, 52, 22, new Color(223, 164, 47), create)
}

/** Fixed viewport keeps scrollable rules outside the persistent action area. */
export const createFriendFormScroll = (parent: Node, x: number, top: number, bottom: number, width: number, contentHeight: number): ScrollView => {
  const height = Math.max(90, top - bottom)
  const clip = new Node('FriendSettingsScrollViewport')
  clip.parent = parent
  clip.setPosition(new Vec3(x, (top + bottom) / 2, 0))
  clip.addComponent(UITransform).setContentSize(width, height)
  clip.addComponent(Mask)
  const content = new Node('FriendSettingsScrollContent')
  content.parent = clip
  const transform = content.addComponent(UITransform)
  transform.setAnchorPoint(0.5, 1)
  transform.setContentSize(width, Math.max(height, contentHeight))
  content.setPosition(new Vec3(0, height / 2, 0))
  const scroll = clip.addComponent(ScrollView)
  scroll.content = content
  scroll.horizontal = false
  scroll.elastic = false
  return scroll
}

export const friendFormAction = (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, height: number, fontSize: number, fill: Color, action: () => void): Node => {
  const node = ui.button('ColoredButton', text, x, width, height, fontSize, {
    fill,
    pressedFill: new Color(Math.max(0, fill.r - 28), Math.max(0, fill.g - 28), Math.max(0, fill.b - 28), fill.a),
    stroke: new Color(255, 235, 151, 255), textColor: new Color(255, 252, 224),
    textOutlineColor: new Color(43, 58, 37, 255), textOutlineWidth: 3, frame: 'control',
  })
  node.setPosition(new Vec3(x, y, 0))
  node.on(Node.EventType.TOUCH_END, action)
  return node
}
