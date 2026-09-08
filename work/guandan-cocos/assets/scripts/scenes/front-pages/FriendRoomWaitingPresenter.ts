import { Color, Node, UITransform, Vec3 } from 'cc'
import type { PlayerId } from '../../core/generated'
import type { LobbyController, LobbySnapshot } from '../../network/LobbyController'
import type { ScreenAdapter } from '../../ui/ScreenAdapter'
import { RuntimeUiFactory } from '../../ui/RuntimeUiFactory'
import { describeFriendRoomRules } from './FriendRoomSettingsPolicy'

/** Owns waiting-room seats, ready state, and server-projected room capabilities. */
export class FriendRoomWaitingPresenter {
  public constructor (
    private readonly screen: ScreenAdapter,
    private readonly lobby: LobbyController,
    private readonly defaultAvatar: string,
    private readonly leave: () => void,
  ) {}

  public render (ui: RuntimeUiFactory, snapshot: LobbySnapshot, signedPlatformEntry: boolean, invite?: () => void): void {
    const roomId = snapshot.roomId
    const myPlayerId = snapshot.myPlayerId
    if (!roomId || !myPlayerId) return
    const safeWidth = this.screen.safeSize().x
    const safeHeight = this.screen.safeSize().y
    const readyPlayers = new Set(snapshot.lobbyReadyPlayerIds ?? [])
    const bots = new Set(snapshot.botPlayerIds ?? [])
    const gameStartPending = Boolean(snapshot.gameStartPending)
    const matched = snapshot.entryKind === 'match'
    const canUseBots = !gameStartPending && !snapshot.observerWaiting && (snapshot.capabilities?.canUseBots ?? !signedPlatformEntry)
    const canKickMembers = !gameStartPending && !snapshot.observerWaiting && (snapshot.capabilities?.canKickMembers ?? true)
    const members = new Set(snapshot.members)
    const occupied = new Set<PlayerId>([...snapshot.members, ...(snapshot.botPlayerIds ?? [])])
    const host = snapshot.isRoomHost ?? myPlayerId === 'p1'
    const observer = snapshot.roomRole === 'observer'
    const canMove = !matched && !gameStartPending && snapshot.roomSettings?.spectator !== 'off' && Boolean(snapshot.roomRole)
    if (!gameStartPending) this.compactButton(ui, '返回', this.screen.safeLeftX(60), this.screen.safeTopY(42), 82, () => this.leave())
    ui.outlinedLabel(matched ? '匹配中' : `好友房 ${roomId}`, 0, this.screen.safeTopY(38), 28, {
      width: Math.min(330, safeWidth * 0.38), height: 42,
      color: new Color(255, 232, 139), outlineColor: new Color(41, 48, 35), outlineWidth: 4,
    })
    const ruleText = matched ? '' : snapshot.roomSettings ? describeFriendRoomRules(snapshot.roomSettings) : ''
    ui.outlinedLabel(ruleText, 0, this.screen.safeTopY(78), 20, {
      width: Math.min(680, safeWidth * 0.76), height: 30,
      color: new Color(225, 239, 226), outlineColor: new Color(34, 61, 54), outlineWidth: 2,
    })
    if (snapshot.error) ui.outlinedLabel(snapshot.error, 0, this.screen.safeTopY(112), 20, {
      width: Math.min(680, safeWidth * 0.76), height: 32,
      color: new Color(255, 170, 139), outlineColor: new Color(72, 31, 27), outlineWidth: 2,
    })

    const ids: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
    const viewerIndex = ids.indexOf(myPlayerId)
    const ordered = ids.map((_, index) => ids[(viewerIndex + index) % ids.length])
    const sideX = Math.max(92, Math.min(118, safeWidth * 0.105))
    const seats = [
      new Vec3(0, this.screen.safeBottomY(canMove ? 90 : 74), 4),
      new Vec3(this.screen.safeRightX(sideX), 4, 4),
      new Vec3(-72, this.screen.safeTopY(164), 4),
      new Vec3(this.screen.safeLeftX(sideX), 4, 4),
    ]
    ordered.forEach((playerId, index) => {
      const seat = new Node(`FriendSeat-${playerId}`)
      seat.parent = ui.parent
      seat.setPosition(seats[index])
      seat.addComponent(UITransform).setContentSize(180, 126)
      const isBot = bots.has(playerId)
      const isMember = members.has(playerId)
      if (isBot || isMember) {
        ui.image(`FriendAvatar-${playerId}`, this.defaultAvatar, 0, 25, 64, 64, seat)
        const display = matched ? '' : !observer && playerId === myPlayerId ? '我' : isBot ? '机器人' : `玩家 ${playerId.slice(1)}`
        const badge = !matched && playerId === (snapshot.hostPlayerId === undefined ? 'p1' : snapshot.hostPlayerId) ? ' · 房主' : ''
        ui.outlinedLabel(`${display}${badge}`, 0, -17, 20, {
          parent: seat, width: 176, height: 26,
          color: new Color(255, 238, 174), outlineColor: new Color(37, 48, 37), outlineWidth: 2,
        })
        const removableBot = canUseBots && host && playerId !== (snapshot.hostPlayerId === undefined ? 'p1' : snapshot.hostPlayerId) && isBot
        const kickableMember = canKickMembers && host && playerId !== (snapshot.hostPlayerId === undefined ? 'p1' : snapshot.hostPlayerId) && isMember && !readyPlayers.has(playerId)
        const seatStatus = matched ? '' : removableBot ? '已准备 · 点击移除' : kickableMember ? '未准备 · 点击移出' : isBot || readyPlayers.has(playerId) ? '已准备' : '未准备'
        ui.outlinedLabel(seatStatus, 0, -45, 20, {
          parent: seat, width: 164, height: 28,
          color: isBot || readyPlayers.has(playerId) ? new Color(139, 239, 177) : new Color(236, 220, 201), outlineColor: new Color(30, 57, 48), outlineWidth: 2,
        })
        if (removableBot) ui.makeInteractive(seat, () => this.lobby.removeBot(playerId), 0.96)
        else if (kickableMember) ui.makeInteractive(seat, () => this.lobby.kickMember(playerId), 0.96)
        return
      }
      const addHit = new Node(`AddBot-${playerId}`)
      addHit.parent = seat
      addHit.setPosition(new Vec3(0, 24, 0))
      addHit.addComponent(UITransform).setContentSize(72, 72)
      ui.outlinedLabel('+', 0, 0, 44, { parent: addHit, width: 64, height: 64, color: new Color(230, 242, 221), outlineColor: new Color(37, 72, 61), outlineWidth: 3 })
      ui.outlinedLabel('空座位', 0, -17, 20, { parent: seat, width: 120, height: 28, color: new Color(230, 239, 225), outlineColor: new Color(37, 62, 55), outlineWidth: 2 })
      if (canMove && !snapshot.observerWaiting) this.coloredButton(new RuntimeUiFactory(seat), '坐下', 0, -48, 106, new Color(45, 157, 102), () => this.lobby.sitDown(playerId))
      else ui.outlinedLabel('等待加入', 0, -45, 20, { parent: seat, width: 150, height: 28, color: new Color(200, 218, 209), outlineWidth: 2 })
      if (host && canUseBots) {
        ui.makeInteractive(addHit, () => this.lobby.addBot(playerId), 0.96)
      }
    })

    const isReady = readyPlayers.has(myPlayerId)
    const humansReady = snapshot.members.filter(playerId => !bots.has(playerId)).every(playerId => readyPlayers.has(playerId))
    const canStart = !snapshot.observerWaiting && occupied.size === 4 && humansReady
    const actionY = safeHeight < 500 ? -8 : -36
    if (gameStartPending) {
      return
    }
    const showReady = !observer && snapshot.lobbyReadyRequired !== false
    const actionCount = Number(Boolean(invite)) + Number(showReady) + Number(host && canStart) + Number(canMove && !observer)
    const actionWidth = Math.min(168, safeWidth * 0.145)
    const gap = 16
    let actionIndex = 0
    const nextX = (): number => (actionIndex++ - (actionCount - 1) / 2) * (actionWidth + gap)
    if (invite) this.coloredButton(ui, '邀请好友', nextX(), actionY, actionWidth, new Color(45, 157, 102), invite)
    if (canMove && !observer) this.coloredButton(ui, '进入观战位', nextX(), actionY, actionWidth, new Color(45, 157, 102), () => this.lobby.standUp())
    if (showReady) {
      this.coloredButton(ui, isReady ? '取消准备' : '准备', nextX(), actionY, actionWidth, isReady ? new Color(78, 105, 102) : new Color(222, 165, 50), () => {
        if (isReady) this.lobby.cancelLobbyReady()
        else this.lobby.setLobbyReady()
      })
    }
    if (host && canStart) {
      this.coloredButton(ui, '开始游戏', nextX(), actionY, actionWidth, new Color(222, 165, 50), () => this.lobby.startGame())
      return
    }
    const emptyCount = Math.max(0, 4 - occupied.size)
    const status = snapshot.observerWaiting ? '观战缓冲中 · 等待延迟画面，不占用玩家席位' : observer ? `观战位 ${snapshot.observers?.length ?? 1} 人 · 点空座下方“坐下”可入座` : emptyCount > 0
      ? host && canUseBots ? `还差 ${emptyCount} 个座位 · 可点击空座加入机器人` : `等待 ${emptyCount} 名牌友加入`
      : host ? '等待其他玩家准备' : '等待房主开始'
    // Guests also have a ready button at x=0. Put the explanation on its own
    // line; sharing actionY used to paint the waiting copy on top of the button.
    ui.outlinedLabel(status, 0, actionY - 56, 20, {
      width: Math.min(640, safeWidth * 0.7), height: 36,
      color: new Color(247, 232, 185), outlineColor: new Color(46, 55, 40), outlineWidth: 2,
    })
  }

  private compactButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, action: () => void): void {
    const node = ui.button('CompactButton', text, x, width, 42, 22, {
      fill: new Color(26, 51, 56, 224), pressedFill: new Color(52, 83, 72, 240), stroke: new Color(241, 207, 101, 245), textColor: new Color(255, 240, 181), textOutlineWidth: 2, radius: 6,
    })
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
  }

  private coloredButton (ui: RuntimeUiFactory, text: string, x: number, y: number, width: number, fill: Color, action: () => void): void {
    const node = ui.button('ColoredButton', text, x, width, 44, 20, {
      fill, pressedFill: new Color(Math.max(0, fill.r - 28), Math.max(0, fill.g - 28), Math.max(0, fill.b - 28), fill.a),
      stroke: new Color(255, 235, 151, 255), textColor: new Color(255, 252, 224), textOutlineColor: new Color(43, 58, 37, 255), textOutlineWidth: 3, radius: 7,
    })
    node.setPosition(new Vec3(x, y, 0))
    node.on(Node.EventType.TOUCH_END, action)
  }
}
