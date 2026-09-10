import { Color, Node, Vec3 } from 'cc'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { FRIEND_ROOM_MODES } from './FriendRoomSettingsPolicy'
import type { FriendRuleTopic } from './FriendRoomRuleContent'

export const renderFriendRoomModeTabs = (
  ui: RuntimeUiFactory, selected: string | undefined, x: number, width: number, panelHeight: number,
  onSelect: (topic: FriendRuleTopic) => void,
): void => {
  FRIEND_ROOM_MODES.forEach((mode, index) => {
    const active = mode.id === selected
    const node = ui.button('FriendModeTab', mode.label, x, width - 18, 50, Math.max(22, Math.min(24, width * 0.13)), {
      fill: active ? new Color(222, 170, 54, 245) : new Color(24, 76, 49, 225),
      stroke: active ? new Color(255, 240, 165) : new Color(112, 151, 105, 190),
      textColor: active ? new Color(61, 43, 20) : new Color(183, 198, 181),
      textOutlineColor: active ? new Color(255, 235, 157) : new Color(28, 36, 32), frame: 'tag',
    })
    node.setPosition(new Vec3(x, panelHeight / 2 - 62 - index * Math.min(64, (panelHeight - 75) / 5), 0))
    if (!active) node.on(Node.EventType.TOUCH_END, () => onSelect(mode.id))
  })
}
