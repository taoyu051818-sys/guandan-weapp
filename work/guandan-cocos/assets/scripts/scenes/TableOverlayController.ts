import { drawUiFrame } from '../ui/UiFrameStyle'
import { BlockInputEvents, Color, Graphics, Label, Node, Tween, UIOpacity, UITransform, Vec3, tween } from 'cc'
import type { PlayerId } from '../core/generated'
import type { LobbyController, NetworkDissolveVote } from '../network/LobbyController'
import { TABLE_BUTTON_HEIGHT, TABLE_BUTTON_FONT, tableButtonWidth } from '../ui/TableButtonMetrics'
import type { RuntimeUiFactory } from '../ui/RuntimeUiFactory'
import type { TableViewport } from '../ui/ScreenAdapter'

export interface TableOverlayControllerDependencies {
  root: Node
  ui: RuntimeUiFactory
  lobby: LobbyController
  initialViewport: TableViewport
  getHumanId: () => PlayerId
  isMultiplayer: () => boolean
  shouldLeaveImmediately: () => boolean
  playerName: (playerId: PlayerId) => string
  leaveTable: () => void
  schedule: (callback: () => void, intervalSeconds: number) => void
  scheduleOnce: (callback: () => void, delaySeconds: number) => void
  unschedule: (callback: () => void) => void
}

export class TableOverlayController {
  private readonly finishToastLabel: Label
  private viewport: TableViewport
  private modal: Node | null = null
  private dissolveDialog: Node | null = null
  private dissolveCountdownLabel: Label | null = null
  private disposed = false

  constructor (private readonly dependencies: TableOverlayControllerDependencies) {
    this.viewport = dependencies.initialViewport
    this.finishToastLabel = dependencies.ui.label('FinishToast', 0, 98, 26)
    this.finishToastLabel.node.getComponent(UITransform)?.setContentSize(560, 56)
    this.finishToastLabel.overflow = Label.Overflow.SHRINK
    this.finishToastLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.finishToastLabel.color = new Color(255, 226, 126)
    this.finishToastLabel.node.active = false

    dependencies.lobby.events.on('guandan:dissolve-vote', this.applyNetworkDissolveVote, this)
    dependencies.schedule(this.refreshDissolveCountdown, 1)
    this.resize(dependencies.initialViewport)
  }

  public setTableVisible (visible: boolean): void {
    if (this.disposed) return
    if (!visible) {
      this.finishToastLabel.node.active = false
      return
    }
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
  }

  public get blocksHandInput (): boolean { return Boolean(this.modal || this.dissolveDialog) }

  public showToast (text: string): void {
    if (this.disposed) return
    const label = this.finishToastLabel
    this.dependencies.unschedule(this.hideFinishToast)
    label.string = text
    label.node.active = true
    label.node.setSiblingIndex(this.dependencies.root.children.length - 1)
    const opacity = label.node.getComponent(UIOpacity) ?? label.node.addComponent(UIOpacity)
    // A repeated tap replaces both the entrance and any pending fade-out.
    Tween.stopAllByTarget(opacity)
    Tween.stopAllByTarget(label.node)
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

  public dispose (): void {
    if (this.disposed) return
    this.disposed = true
    this.dependencies.lobby.events.off('guandan:dissolve-vote', this.applyNetworkDissolveVote, this)
    this.dependencies.unschedule(this.refreshDissolveCountdown)
    this.dependencies.unschedule(this.hideFinishToast)
    this.destroyNode(this.modal)
    this.modal = null
    this.destroyNode(this.dissolveDialog)
    this.dissolveDialog = null
    this.dissolveCountdownLabel = null
    const opacity = this.finishToastLabel.node.getComponent(UIOpacity)
    if (opacity) Tween.stopAllByTarget(opacity)
    Tween.stopAllByTarget(this.finishToastLabel.node)
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
    drawUiFrame(graphics, x, y, width, height)
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

  private makeButton (name: string, text: string, _width: number): Node {
    return this.dependencies.ui.button(name, text, 0, tableButtonWidth(text), TABLE_BUTTON_HEIGHT, TABLE_BUTTON_FONT)
  }

  private destroyNode (node: Node | null): void {
    if (node?.isValid) { node.active = false; node.destroy() }
  }
}
