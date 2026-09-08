import { EditBox, Node, Vec3 } from 'cc'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import type { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import type { FriendRoomPlatformSnapshot } from './FriendRoomPlatformFlow'

export type FriendRoomPlatformActions = Readonly<{
  create: () => void
  join: (inviteText: string) => void
  cancel: () => void
  back: () => void
}>

/** Renders authenticated friend-room entry and sharing without owning transport state. */
export class FriendRoomPlatformPresenter {
  private inviteInput: EditBox | null = null

  public constructor (private readonly screen: ScreenAdapter) {}

  public renderEntry (
    ui: RuntimeUiFactory,
    state: FriendRoomPlatformSnapshot,
    actions: FriendRoomPlatformActions,
  ): void {
    const draft = this.inviteInput?.string ?? ''
    this.inviteInput = null
    ui.menuLabel('好友房', 0, this.screen.safeTopY(80), 42)
    ui.menuLabel(
      state.busy === 'creating' ? '正在安全创建房间…' : state.busy === 'joining' ? '正在加入好友房…' : '创建房间后，点击邀请好友发送微信邀请卡片',
      0,
      this.screen.safeTopY(138),
      20,
    )
    ui.outlinedLabel('点击微信邀请卡片即可加入 · 旧邀请口令仍可在下方使用', 0, 112, 20, {
      width: Math.min(720, this.screen.safeSize().x - 40), height: 34,
    })
    if (state.busy) {
      this.button(ui, '取消进入', 0, 24, 220, actions.cancel)
    } else {
      this.button(ui, '设置并创建好友房', 0, 56, 300, actions.create)
      this.inviteInput = ui.friendRoomInviteInput(0, -18, draft)
      this.button(ui, '加入好友房', 0, -86, 260, () => actions.join(this.inviteInput?.string.trim() ?? ''))
    }
    this.button(ui, '返回大厅', 0, this.screen.safeBottomY(42), 220, actions.back)
  }

  public resetInput (): void { this.inviteInput = null }

  private button (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, action: () => void): Node {
    const node = ui.button('FriendRoomPlatformButton', text, x, width, 48, 22)
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
    return node
  }
}
