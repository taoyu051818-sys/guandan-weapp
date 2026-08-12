import { BlockInputEvents, Color, Graphics, Label, Node, Tween, UIOpacity, UITransform, Vec3, tween } from 'cc'
import type { PlayerId } from '../core/generated'
import type { LobbyController, NetworkDissolveVote } from '../network/LobbyController'
import { ChatController, QUICK_CHAT_PHRASES } from '../ui/ChatController'
import type { RuntimeUiFactory } from '../ui/RuntimeUiFactory'
import type { TableViewport } from '../ui/ScreenAdapter'

export interface TableOverlayControllerDependencies {
  root: Node
  ui: RuntimeUiFactory
  lobby: LobbyController
  chat: ChatController
  initialViewport: TableViewport
  getHumanId: () => PlayerId
  isMultiplayer: () => boolean
  isInteractionDisabled: () => boolean
  shouldLeaveImmediately: () => boolean
  playerName: (playerId: PlayerId) => string
  leaveTable: () => void
  playVoice: (voice: string) => void
  playChatPulse: (playerId: PlayerId, ownBubbleNode: Node) => void
  refreshPresentation: () => void
  schedule: (callback: () => void, intervalSeconds: number) => void
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  unschedule: (callback: () => void) => void
}

export class TableOverlayController {
  private readonly ownChatLabel: Label
  private readonly finishToastLabel: Label
  private viewport: TableViewport
  private modal: Node | null = null
  private dissolveDialog: Node | null = null
  private dissolveCountdownLabel: Label | null = null
  private quickChatNodes: Node[] = []
  private quickChatMuted = false
  private tableVisible = false
  private disposed = false

  constructor (private readonly dependencies: TableOverlayControllerDependencies) {
    this.viewport = dependencies.initialViewport
    this.ownChatLabel = dependencies.ui.label('OwnChatBubble', -430, -123, 18)
    this.ownChatLabel.node.getComponent(UITransform)?.setContentSize(420, 34)
    this.ownChatLabel.overflow = Label.Overflow.SHRINK
    this.ownChatLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.ownChatLabel.color = new Color(245, 239, 215)
    this.ownChatLabel.node.active = false

    this.finishToastLabel = dependencies.ui.label('FinishToast', 0, 98, 26)
    this.finishToastLabel.node.getComponent(UITransform)?.setContentSize(560, 56)
    this.finishToastLabel.overflow = Label.Overflow.SHRINK
    this.finishToastLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.finishToastLabel.color = new Color(255, 226, 126)
    this.finishToastLabel.node.active = false

    dependencies.lobby.events.on('guandan:chat', this.applyNetworkChat, this)
    dependencies.lobby.events.on('guandan:dissolve-vote', this.applyNetworkDissolveVote, this)
    dependencies.chat.events.on('guandan:chat', this.handleChatChanged, this)
    dependencies.schedule(this.refreshDissolveCountdown, 1)
    this.resize(dependencies.initialViewport)
  }

  public setTableVisible (visible: boolean): void {
    if (this.disposed) return
    this.tableVisible = visible
    if (!visible) {
      this.clearQuickChatPanel()
      this.finishToastLabel.node.active = false
      this.ownChatLabel.node.active = false
      return
    }
    this.renderOwnChat()
  }

  public resize (viewport: TableViewport): void {
    if (this.disposed) return
    this.viewport = viewport
    const safeWidth = viewport.width - viewport.safeLeft - viewport.safeRight
    const safeTop = viewport.halfHeight - viewport.safeTop - 158
    const safeBottom = -viewport.halfHeight + viewport.safeBottom + 260
    const toastY = safeBottom <= safeTop ? Math.max(safeBottom, Math.min(safeTop, 98)) : (safeBottom + safeTop) / 2
    this.finishToastLabel.node.setPosition(new Vec3(0, toastY, 90))
    this.finishToastLabel.node.getComponent(UITransform)?.setContentSize(Math.max(220, Math.min(560, safeWidth - 32)), 56)
    this.ownChatLabel.node.setPosition(new Vec3(
      -viewport.halfWidth + viewport.safeLeft + 220,
      viewport.halfHeight - viewport.safeTop - 235,
      0,
    ))
    this.clearQuickChatPanel()
  }

  public renderOwnChat (): void {
    if (this.disposed) return
    const humanId = this.dependencies.getHumanId()
    this.dependencies.chat.setViewer(humanId)
    const message = this.dependencies.chat.get(humanId)?.message ?? ''
    this.ownChatLabel.string = message
    this.ownChatLabel.node.active = this.tableVisible && Boolean(message)
  }

  public chatMessage (playerId: PlayerId): string | undefined {
    if (this.disposed) return undefined
    this.dependencies.chat.setViewer(this.dependencies.getHumanId())
    return this.dependencies.chat.get(playerId)?.message
  }

  public showToast (text: string): void {
    if (this.disposed) return
    const label = this.finishToastLabel
    this.dependencies.unschedule(this.hideFinishToast)
    label.string = text
    label.node.active = true
    label.node.setSiblingIndex(this.dependencies.root.children.length - 1)
    const opacity = label.node.getComponent(UIOpacity) ?? label.node.addComponent(UIOpacity)
    opacity.opacity = 0
    label.node.setScale(new Vec3(0.82, 0.82, 1))
    tween(opacity).to(0.14, { opacity: 255 }).start()
    tween(label.node).to(0.2, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
    this.dependencies.scheduleOnce(this.hideFinishToast, 1.6)
  }

  public requestLeave (): void {
    if (this.disposed) return
    if (this.dependencies.shouldLeaveImmediately()) {
      this.dependencies.leaveTable()
      return
    }
    if (this.modal) return
    const multiplayer = this.dependencies.isMultiplayer()
    const overlay = this.createModalShade('ExitTableDialog', 185)
    const graphics = overlay.getComponent(Graphics)!
    const panelWidth = multiplayer ? 680 : 520
    this.drawPanel(graphics, -panelWidth / 2, -130, panelWidth, 260)
    const title = this.makeLabel('ExitTitle', 0, 58, 32)
    title.string = multiplayer ? '退出联机牌局？' : '返回大厅？'
    title.node.parent = overlay
    const detail = this.makeLabel('ExitDetail', 0, 15, 18)
    detail.string = multiplayer ? '安全退出后由托管继续；申请解散需全员同意。' : '当前未完成牌局不会计入战绩。'
    detail.node.parent = overlay
    const stay = this.makeButton('StayButton', '继续游戏', multiplayer ? 176 : 210)
    stay.parent = overlay
    stay.setPosition(new Vec3(multiplayer ? -210 : -125, -70, 0))
    stay.on(Node.EventType.TOUCH_END, this.clearModal, this)
    const leave = this.makeButton('LeaveButton', multiplayer ? '安全退出' : '返回大厅', multiplayer ? 176 : 210)
    leave.parent = overlay
    leave.setPosition(new Vec3(multiplayer ? 0 : 125, -70, 0))
    leave.on(Node.EventType.TOUCH_END, this.leaveTable, this)
    if (multiplayer) {
      const dissolve = this.makeButton('DissolveButton', '申请解散', 176)
      dissolve.parent = overlay
      dissolve.setPosition(new Vec3(210, -70, 0))
      dissolve.on(Node.EventType.TOUCH_END, this.proposeDissolve, this)
    }
    this.presentModal(overlay)
  }

  public clearModal (): void {
    if (this.disposed) return
    this.destroyNode(this.modal)
    this.modal = null
  }

  public clearDialogs (): void {
    if (this.disposed) return
    this.clearModal()
    this.clearDissolveDialog()
  }

  public showNotice (title: string, message = ''): void {
    if (this.disposed || this.modal) return
    const overlay = this.createModalShade('DevelopmentDialog', 175)
    const graphics = overlay.getComponent(Graphics)!
    this.drawPanel(graphics, -235, -105, 470, 210)
    const heading = this.makeLabel('DevelopmentTitle', 0, 48, 32)
    heading.string = title
    heading.node.parent = overlay
    const detail = this.makeLabel('DevelopmentDetail', 0, 4, 19)
    detail.string = message
    detail.node.parent = overlay
    detail.node.active = Boolean(message)
    const close = this.makeButton('DevelopmentClose', '知道了', 190)
    close.parent = overlay
    close.setPosition(new Vec3(0, -58, 0))
    close.on(Node.EventType.TOUCH_END, this.clearModal, this)
    this.presentModal(overlay)
  }

  public toggleQuickChatPanel (): void {
    if (this.disposed) return
    if (this.quickChatNodes.length) {
      this.clearQuickChatPanel()
      return
    }
    if (this.dependencies.isInteractionDisabled()) {
      this.showToast('本好友房已禁止互动')
      return
    }
    const chatPanelTop = -this.viewport.halfHeight + this.viewport.safeBottom + 535
    const chatPanelX = -this.viewport.halfWidth + this.viewport.safeLeft + 220
    QUICK_CHAT_PHRASES.forEach((phrase, index) => {
      const node = this.dependencies.ui.quickChatButton(phrase.text, chatPanelX, chatPanelTop - index * 48)
      node.on(Node.EventType.TOUCH_END, () => {
        this.sendQuickChat(phrase)
        this.clearQuickChatPanel()
      }, this)
      this.quickChatNodes.push(node)
    })
    const mute = this.dependencies.ui.quickChatButton(
      this.quickChatMuted ? '取消屏蔽快捷语' : '屏蔽其他玩家快捷语',
      chatPanelX,
      chatPanelTop - QUICK_CHAT_PHRASES.length * 48,
    )
    mute.on(Node.EventType.TOUCH_END, this.toggleQuickChatMute, this)
    this.quickChatNodes.push(mute)
  }

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.dependencies.lobby.events.off('guandan:chat', this.applyNetworkChat, this)
    this.dependencies.lobby.events.off('guandan:dissolve-vote', this.applyNetworkDissolveVote, this)
    this.dependencies.chat.events.off('guandan:chat', this.handleChatChanged, this)
    this.dependencies.unschedule(this.refreshDissolveCountdown)
    this.dependencies.unschedule(this.hideFinishToast)
    this.clearQuickChatPanel()
    this.destroyNode(this.modal)
    this.modal = null
    this.destroyNode(this.dissolveDialog)
    this.dissolveDialog = null
    this.dissolveCountdownLabel = null
    const opacity = this.finishToastLabel.node.getComponent(UIOpacity)
    if (opacity) Tween.stopAllByTarget(opacity)
    Tween.stopAllByTarget(this.finishToastLabel.node)
    this.destroyNode(this.ownChatLabel.node)
    this.destroyNode(this.finishToastLabel.node)
  }

  private readonly hideFinishToast = (): void => {
    if (this.disposed) return
    const label = this.finishToastLabel
    const opacity = label.node.getComponent(UIOpacity)
    if (!opacity) {
      label.node.active = false
      return
    }
    tween(opacity).to(0.18, { opacity: 0 }).call(() => {
      if (!this.disposed && label.node.isValid) label.node.active = false
    }).start()
  }

  private readonly leaveTable = (): void => {
    if (this.disposed) return
    this.clearModal()
    this.dependencies.leaveTable()
  }

  private readonly proposeDissolve = (): void => {
    if (this.disposed) return
    this.clearModal()
    if (this.dependencies.lobby.proposeDissolve() === null) this.showToast('解散申请发送失败，请检查网络')
    else this.showToast('已发起解散，等待其他玩家表决')
  }

  private readonly applyNetworkDissolveVote = (packet: { vote: NetworkDissolveVote | null, outcome: 'rejected' | 'expired' | null }): void => {
    if (this.disposed) return
    if (packet.outcome) {
      this.clearDissolveDialog()
      this.showToast(packet.outcome === 'rejected' ? '解散申请未通过，牌局继续' : '解散投票已超时，牌局继续')
      return
    }
    const vote = packet.vote
    const humanId = this.dependencies.getHumanId()
    if (!vote || vote.votes[humanId] !== 'pending') {
      this.clearDissolveDialog()
      return
    }
    this.showDissolveVoteDialog(vote)
  }

  private showDissolveVoteDialog (vote: NetworkDissolveVote): void {
    if (this.disposed) return
    this.clearModal()
    this.clearDissolveDialog()
    const overlay = this.createModalShade('DissolveVoteDialog', 185)
    const graphics = overlay.getComponent(Graphics)!
    this.drawPanel(graphics, -285, -130, 570, 260)
    const title = this.makeLabel('DissolveVoteTitle', 0, 68, 30)
    title.string = `${this.dependencies.playerName(vote.initiator)} 申请解散牌局`
    title.node.parent = overlay
    const agreed = Object.values(vote.votes).filter(choice => choice === 'agree').length
    const detail = this.makeLabel('DissolveVoteDetail', 0, 24, 19)
    detail.string = `当前同意 ${agreed}/4；一人拒绝即继续牌局`
    detail.node.parent = overlay
    const countdown = this.makeLabel('DissolveVoteCountdown', 0, -12, 18)
    countdown.node.parent = overlay
    this.dissolveCountdownLabel = countdown
    const refuse = this.makeButton('DissolveRefuse', '拒绝', 210)
    refuse.parent = overlay
    refuse.setPosition(new Vec3(-125, -72, 0))
    refuse.on(Node.EventType.TOUCH_END, () => this.voteDissolve(false), this)
    const agree = this.makeButton('DissolveAgree', '同意解散', 210)
    agree.parent = overlay
    agree.setPosition(new Vec3(125, -72, 0))
    agree.on(Node.EventType.TOUCH_END, () => this.voteDissolve(true), this)
    overlay.setSiblingIndex(this.dependencies.root.children.length - 1)
    this.dissolveDialog = overlay
    this.refreshDissolveCountdown()
  }

  private voteDissolve (agree: boolean): void {
    if (this.disposed) return
    this.dependencies.lobby.voteDissolve(agree)
    this.clearDissolveDialog()
  }

  private readonly refreshDissolveCountdown = (): void => {
    if (this.disposed) return
    const vote = this.dependencies.lobby.snapshot.dissolveVote
    if (!this.dissolveCountdownLabel || !vote) return
    this.dissolveCountdownLabel.string = `剩余 ${Math.max(0, Math.ceil((vote.expiresAt - Date.now()) / 1000))} 秒`
  }

  private clearDissolveDialog (): void {
    this.destroyNode(this.dissolveDialog)
    this.dissolveDialog = null
    this.dissolveCountdownLabel = null
  }

  private readonly applyNetworkChat = (packet: { playerId: PlayerId, text: string }): void => {
    if (this.disposed) return
    const phrase = QUICK_CHAT_PHRASES.find(item => item.text === packet.text)
    const viewerId = this.dependencies.getHumanId()
    const blocked = this.dependencies.chat.isBlocked(viewerId, packet.playerId)
    const decision = this.dependencies.chat.show(packet.playerId, packet.text, phrase?.voice ?? '')
    if (phrase && decision.accepted && !blocked) {
      this.dependencies.playVoice(phrase.voice)
      this.dependencies.playChatPulse(packet.playerId, this.ownChatLabel.node)
    }
  }

  private readonly handleChatChanged = (): void => {
    if (this.disposed) return
    this.dependencies.refreshPresentation()
  }

  private sendQuickChat (phrase: (typeof QUICK_CHAT_PHRASES)[number]): void {
    if (this.disposed) return
    if (this.dependencies.isInteractionDisabled()) {
      this.showToast('本好友房已禁止互动')
      return
    }
    const humanId = this.dependencies.getHumanId()
    if (this.dependencies.isMultiplayer()) {
      if (this.dependencies.lobby.chat(phrase.text) === null) this.showToast('快捷语发送失败，请检查网络连接')
      return
    }
    const decision = this.dependencies.chat.send(humanId, phrase)
    if (!decision.accepted) {
      const retrySeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000))
      this.showToast(decision.reason === 'unknown-phrase' ? '快捷语不可用' : `请 ${retrySeconds} 秒后再发送快捷语`)
      return
    }
    this.dependencies.playVoice(phrase.voice)
    this.dependencies.playChatPulse(humanId, this.ownChatLabel.node)
  }

  private readonly toggleQuickChatMute = (): void => {
    if (this.disposed) return
    const humanId = this.dependencies.getHumanId()
    this.quickChatMuted = !this.quickChatMuted
    ;(['p1', 'p2', 'p3', 'p4'] as const).filter(id => id !== humanId).forEach(id => {
      if (this.quickChatMuted) this.dependencies.chat.block(humanId, id)
      else this.dependencies.chat.unblock(humanId, id)
    })
    this.clearQuickChatPanel()
    this.dependencies.refreshPresentation()
  }

  private createModalShade (name: string, alpha: number): Node {
    const overlay = new Node(name)
    overlay.parent = this.dependencies.root
    overlay.addComponent(UITransform).setContentSize(this.viewport.width, this.viewport.height)
    overlay.addComponent(BlockInputEvents)
    const graphics = overlay.addComponent(Graphics)
    graphics.fillColor = new Color(2, 12, 14, alpha)
    graphics.rect(-this.viewport.halfWidth, -this.viewport.halfHeight, this.viewport.width, this.viewport.height)
    graphics.fill()
    return overlay
  }

  private drawPanel (graphics: Graphics, x: number, y: number, width: number, height: number): void {
    graphics.fillColor = new Color(26, 43, 43, 250)
    graphics.strokeColor = new Color(218, 179, 79, 255)
    graphics.lineWidth = 3
    graphics.roundRect(x, y, width, height, 22)
    graphics.fill()
    graphics.stroke()
  }

  private presentModal (overlay: Node): void {
    if (this.disposed) {
      this.destroyNode(overlay)
      return
    }
    overlay.setSiblingIndex(this.dependencies.root.children.length - 1)
    this.modal = overlay
  }

  private makeLabel (name: string, x: number, y: number, fontSize: number): Label {
    return this.dependencies.ui.label(name, x, y, fontSize)
  }

  private makeButton (name: string, text: string, width: number): Node {
    return this.dependencies.ui.button(name, text, 0, width)
  }

  private clearQuickChatPanel (): void {
    while (this.quickChatNodes.length) this.destroyNode(this.quickChatNodes.pop() ?? null)
  }

  private destroyNode (node: Node | null): void {
    if (node?.isValid) node.destroy()
  }
}
