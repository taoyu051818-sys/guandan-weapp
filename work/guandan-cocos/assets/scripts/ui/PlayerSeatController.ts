import { _decorator, Color, Component, Graphics, Label, Node, Tween, UITransform, Vec3, tween } from 'cc'
import type { Player } from '../core/generated'
import { applyForegroundTextStyle } from './RuntimeUiFactory'

const { ccclass } = _decorator

/** Reusable four-seat player panel, corresponding to the desktop PlayerArea. */
@ccclass('PlayerSeatController')
export class PlayerSeatController extends Component {
  private label: Label | null = null
  private graphics: Graphics | null = null
  private chatLabel: Label | null = null
  private chatBubble: Node | null = null
  private connectionStatus: Node | null = null
  private connectionStatusGraphics: Graphics | null = null
  private connectionStatusLabel: Label | null = null
  private offline = false
  private connectionStatusToken = 0
  private turnActive = false
  private previousChat = ''

  protected onLoad (): void {
    const transform = this.getComponent(UITransform) ?? this.addComponent(UITransform)
    transform!.setContentSize(176, 60)
    this.graphics = this.getComponent(Graphics) ?? this.addComponent(Graphics)
    const labelNode = new Node('SeatText')
    labelNode.parent = this.node
    labelNode.addComponent(UITransform).setContentSize(166, 56)
    this.label = labelNode.addComponent(Label)
    this.label!.fontSize = 17
    this.label!.lineHeight = 22
    this.label!.horizontalAlign = Label.HorizontalAlign.CENTER
    this.label!.verticalAlign = Label.VerticalAlign.CENTER
    applyForegroundTextStyle(this.label!, new Color(18, 31, 34, 255), 2)
    const connectionStatus = new Node('ConnectionStatus')
    connectionStatus.parent = this.node
    connectionStatus.setPosition(new Vec3(52, 22, 2))
    connectionStatus.addComponent(UITransform).setContentSize(64, 24)
    this.connectionStatusGraphics = connectionStatus.addComponent(Graphics)
    const connectionText = new Node('ConnectionStatusText')
    connectionText.parent = connectionStatus
    connectionText.addComponent(UITransform).setContentSize(60, 22)
    this.connectionStatusLabel = connectionText.addComponent(Label)
    this.connectionStatusLabel.fontSize = 14
    this.connectionStatusLabel.lineHeight = 18
    this.connectionStatusLabel.horizontalAlign = Label.HorizontalAlign.CENTER
    this.connectionStatusLabel.verticalAlign = Label.VerticalAlign.CENTER
    applyForegroundTextStyle(this.connectionStatusLabel, new Color(20, 34, 34, 255), 1)
    connectionStatus.active = false
    this.connectionStatus = connectionStatus
    const bubble = new Node('ChatBubble')
    bubble.parent = this.node
    bubble.setPosition(new Vec3(0, 64, 0))
    bubble.addComponent(UITransform).setContentSize(280, 48)
    const bubbleGraphics = bubble.addComponent(Graphics)
    bubbleGraphics.fillColor = new Color(249, 245, 232, 250)
    bubbleGraphics.strokeColor = new Color(188, 143, 57, 255)
    bubbleGraphics.lineWidth = 2
    bubbleGraphics.roundRect(-140, -24, 280, 48, 14)
    bubbleGraphics.fill()
    bubbleGraphics.stroke()
    const chatText = new Node('ChatText')
    chatText.parent = bubble
    chatText.addComponent(UITransform).setContentSize(260, 42)
    this.chatLabel = chatText.addComponent(Label)
    this.chatLabel.fontSize = 16
    this.chatLabel.lineHeight = 22
    this.chatLabel.horizontalAlign = Label.HorizontalAlign.CENTER
    this.chatLabel.verticalAlign = Label.VerticalAlign.CENTER
    this.chatLabel.color = new Color(43, 48, 49)
    applyForegroundTextStyle(this.chatLabel, new Color(255, 249, 229, 255), 1)
    bubble.active = false
    this.chatBubble = bubble
  }

  public render (player: Player, isTurn: boolean, showHand = false, chat?: string, finishPlace = 0): void {
    const graphic = this.graphics!
    const handCount = player.hand.length
    const danger = !finishPlace && handCount > 0 && handCount <= 2
    graphic.clear()
    graphic.fillColor = isTurn ? new Color(85, 62, 24, 245) : new Color(22, 34, 39, 230)
    graphic.strokeColor = isTurn ? new Color(239, 201, 90, 255) : danger ? new Color(226, 84, 64, 255) : new Color(101, 123, 129, 220)
    graphic.lineWidth = isTurn || danger ? 3 : 1
    graphic.roundRect(-88, -30, 176, 60, 15)
    graphic.fill()
    graphic.stroke()
    const team = player.team === 'teamA' ? '我方' : '对方'
    const rankNames = ['头游', '二游', '三游', '末游']
    const detail = finishPlace > 0
      ? rankNames[finishPlace - 1]
      : showHand
        ? `明牌 ${handCount} 张`
        : handCount <= 10
          ? `剩余 ${handCount} 张`
          : ''
    this.label!.color = danger ? new Color(255, 151, 126) : isTurn ? new Color(255, 229, 157) : new Color(231, 236, 232)
    this.label!.string = `${player.name}  ·  ${team}${detail ? `\n${detail}` : ''}`
    if (isTurn !== this.turnActive) {
      this.turnActive = isTurn
      Tween.stopAllByTarget(this.node)
      this.node.setScale(Vec3.ONE)
      if (isTurn) {
        tween(this.node).repeatForever(
          tween().to(0.65, { scale: new Vec3(1.035, 1.035, 1) }, { easing: 'sineInOut' }).to(0.65, { scale: Vec3.ONE }, { easing: 'sineInOut' }),
        ).start()
      }
    }
    if (this.chatLabel) {
      this.chatLabel.string = chat ?? ''
      if (this.chatBubble) this.chatBubble.active = Boolean(chat)
      if (chat && chat !== this.previousChat && this.chatBubble) {
        this.chatBubble.setScale(new Vec3(0.72, 0.72, 1))
        tween(this.chatBubble).to(0.18, { scale: Vec3.ONE }, { easing: 'backOut' }).start()
      }
      this.previousChat = chat ?? ''
    }
  }

  /** Projects authoritative room membership without touching gameplay or hand selection state. */
  public setOffline (offline: boolean): void {
    if (offline === this.offline) return
    const wasOffline = this.offline
    this.offline = offline
    const token = ++this.connectionStatusToken
    if (offline) {
      this.showConnectionStatus('离线', new Color(255, 137, 112), new Color(92, 32, 29, 245))
      return
    }
    if (!wasOffline) return
    this.showConnectionStatus('已恢复', new Color(143, 238, 183), new Color(25, 76, 54, 245))
    this.scheduleOnce(() => {
      if (token === this.connectionStatusToken && !this.offline && this.connectionStatus) this.connectionStatus.active = false
    }, 1.5)
  }

  /** Removes connection UI when leaving a multiplayer table so it cannot leak into another round. */
  public clearConnectionStatus (): void {
    this.offline = false
    this.connectionStatusToken += 1
    if (this.connectionStatus) this.connectionStatus.active = false
  }

  private showConnectionStatus (text: string, textColor: Color, fillColor: Color): void {
    if (!this.connectionStatus || !this.connectionStatusLabel || !this.connectionStatusGraphics) return
    const graphic = this.connectionStatusGraphics
    graphic.clear()
    graphic.fillColor = fillColor
    graphic.strokeColor = textColor
    graphic.lineWidth = 1
    graphic.roundRect(-32, -12, 64, 24, 8)
    graphic.fill()
    graphic.stroke()
    this.connectionStatusLabel.string = text
    this.connectionStatusLabel.color = textColor
    this.connectionStatus.active = true
  }

  /** Keeps the top teammate's chat bubble in its own lane, clear of HUD and played cards. */
  public setChatBubbleAbove (above: boolean): void {
    this.chatBubble?.setPosition(above ? new Vec3(0, 64, 0) : new Vec3(-70, -66, 0))
  }

  /** Hidden opponents play from a stable point beside their avatar panel. */
  public getPlayOriginWorldPosition (): Vec3 {
    return this.node.worldPosition.clone()
  }
}
