import { _decorator, Color, Component, Graphics, Label, Node, UITransform, Vec3 } from 'cc'
import { GameManager, type GameSnapshot } from '../game/GameManager'
import { HandController } from '../ui/HandController'
import { GameSession } from '../session/GameSession'
import { GroupingController, type GroupingResult } from '../game/GroupingController'
import type { Difficulty } from '../core/generated/lib/ai'

const { ccclass, property } = _decorator

/** Attach this to the Game scene root and bind editor nodes in the Inspector. */
@ccclass('GameScene')
export class GameScene extends Component {
  @property(GameSession)
  public session: GameSession | null = null

  @property(GameManager)
  public gameManager: GameManager | null = null

  @property(GroupingController)
  public grouping: GroupingController | null = null

  @property(HandController)
  public hand: HandController | null = null

  @property(Label)
  public hintLabel: Label | null = null

  @property(Label)
  public phaseLabel: Label | null = null

  @property(Label)
  public scoreLabel: Label | null = null

  @property(Label)
  public overlayLabel: Label | null = null

  @property(Node)
  public playButton: Node | null = null

  @property(Node)
  public passButton: Node | null = null

  @property(Node)
  public confirmTributeButton: Node | null = null

  @property(Node)
  public finishTributeButton: Node | null = null

  @property(Node)
  public nextRoundButton: Node | null = null

  private menuNodes: Node[] = []
  private groupingNodes: Node[] = []
  private groupingResult: GroupingResult | null = null
  private tutorialStep = 0

  protected onLoad (): void {
    if (!this.session) this.session = this.getComponent(GameSession) ?? this.addComponent(GameSession)
    if (!this.gameManager) this.gameManager = this.getComponent(GameManager) ?? this.addComponent(GameManager)
    if (!this.grouping) this.grouping = this.getComponent(GroupingController) ?? this.addComponent(GroupingController)
    const manager = this.gameManager!
    manager.session = this.session
    this.ensureFallbackUi()
    manager.node.on('guandan:state', this.render, this)
    this.hand?.node.on('guandan:card-toggle', manager.toggleCard, manager)
    this.playButton?.on(Node.EventType.TOUCH_END, manager.playSelected, manager)
    this.passButton?.on(Node.EventType.TOUCH_END, manager.pass, manager)
    this.confirmTributeButton?.on(Node.EventType.TOUCH_END, manager.confirmTribute, manager)
    this.finishTributeButton?.on(Node.EventType.TOUCH_END, manager.finishTribute, manager)
    this.nextRoundButton?.on(Node.EventType.TOUCH_END, manager.nextRound, manager)
  }

  protected start (): void {
    this.showMenu()
  }

  protected onDestroy (): void {
    this.gameManager?.node.off('guandan:state', this.render, this)
  }

  private render (snapshot: GameSnapshot): void {
    this.hand?.render(snapshot.state.players.p1.hand, snapshot.selectedCardIds)
    if (this.hintLabel) this.hintLabel.string = snapshot.hint
    if (this.phaseLabel) this.phaseLabel.string = snapshot.phase === 'playing' ? `级牌 ${snapshot.state.currentLevel}` : snapshot.phase === 'tribute' ? '进贡与还贡' : '本局结算'
    if (this.scoreLabel) this.scoreLabel.string = `我方 ${snapshot.teamLevels.teamA} 级 · ${snapshot.scores.teamA} 分    对方 ${snapshot.teamLevels.teamB} 级 · ${snapshot.scores.teamB} 分`

    const isPlaying = snapshot.phase === 'playing'
    const isTribute = snapshot.phase === 'tribute'
    const isSettlement = snapshot.phase === 'settlement'
    if (this.playButton) this.playButton.active = isPlaying
    if (this.passButton) this.passButton.active = isPlaying
    if (this.confirmTributeButton) this.confirmTributeButton.active = isTribute && !snapshot.tribute?.isAntiTribute && snapshot.tribute?.phase !== 'done'
    if (this.finishTributeButton) this.finishTributeButton.active = isTribute && Boolean(snapshot.tribute?.isAntiTribute || snapshot.tribute?.phase === 'done')
    if (this.nextRoundButton) this.nextRoundButton.active = isSettlement

    if (this.overlayLabel) {
      this.overlayLabel.node.active = !isPlaying
      if (isTribute && snapshot.tribute) {
        const title = snapshot.tribute.isAntiTribute ? '抗贡成立' : snapshot.tribute.phase === 'tributing' ? '进贡阶段' : snapshot.tribute.phase === 'returning' ? '还贡阶段' : '贡还完成'
        const actions = snapshot.tribute.actions.map(action => `${action.from} → ${action.to}`).join('\n')
        this.overlayLabel.string = `${title}\n${actions}`
      } else if (isSettlement && snapshot.settlement) {
        this.overlayLabel.string = `${snapshot.settlement.winnerTeam === 'teamA' ? '本局胜利' : '本局失利'}\n${snapshot.settlement.message}\n${snapshot.settlement.fullRank.join(' · ')}`
      }
    }
  }

  /** Lets the first playable scene run before the art prefabs are bound in Creator. */
  private ensureFallbackUi (): void {
    if (!this.hand) {
      const handNode = new Node('HumanHand')
      handNode.parent = this.node
      handNode.setPosition(new Vec3(0, -265, 0))
      handNode.addComponent(UITransform).setContentSize(1040, 150)
      this.hand = handNode.addComponent(HandController)
    }
    this.hintLabel ??= this.makeLabel('Hint', 0, -150, 24)
    this.phaseLabel ??= this.makeLabel('Phase', 0, 282, 30)
    this.scoreLabel ??= this.makeLabel('Score', 0, 232, 22)
    this.overlayLabel ??= this.makeLabel('Overlay', 0, 42, 30)
    this.playButton ??= this.makeButton('PlayButton', '出牌', -115)
    this.passButton ??= this.makeButton('PassButton', '不要', 0)
    this.confirmTributeButton ??= this.makeButton('ConfirmTributeButton', '确认贡牌', 115)
    this.finishTributeButton ??= this.makeButton('FinishTributeButton', '开始本局', 115)
    this.nextRoundButton ??= this.makeButton('NextRoundButton', '下一局', 115)
  }

  private showMenu (): void {
    this.clearNodes(this.groupingNodes)
    this.setTableVisible(false)
    const title = this.makeMenuLabel('掼 蛋 大 师', 0, 210, 56)
    const subtitle = this.makeMenuLabel('THE ROYAL GUANDAN', 0, 145, 18)
    this.menuNodes.push(title.node, subtitle.node)
    this.addMenuButton('标准对局', 60, () => this.beginGrouping('medium', 'standard'))
    this.addMenuButton('双明牌教学', 5, () => this.beginGrouping('easy', 'double_open'))
    this.addMenuButton('大师挑战', -50, () => this.beginGrouping('master', 'standard'))
    this.addMenuButton('多人联机大厅（开发中）', -105, () => this.session?.enterLobby())
    this.addMenuButton('新手教程', -160, () => this.showTutorial())
    this.addMenuButton('游戏设置', -215, () => this.showSettings())
  }

  private beginGrouping (difficulty: Difficulty, mode: 'standard' | 'double_open' | 'campaign'): void {
    this.clearNodes(this.menuNodes)
    this.session?.beginLocalGame(difficulty, mode)
    this.showGrouping()
  }

  private showGrouping (): void {
    this.clearNodes(this.groupingNodes)
    const title = this.makeMenuLabel('摸牌定庄', 0, 205, 46)
    const detail = this.makeMenuLabel('红牌为我方（玩家、对家），黑牌为对方。点数最大者先出。', 0, 125, 22)
    this.groupingNodes.push(title.node, detail.node)
    const draw = this.addGroupingButton('摸牌', 20, () => this.drawGrouping())
    const back = this.addGroupingButton('返回主菜单', -45, () => this.showMenu())
    this.groupingNodes.push(draw, back)
  }

  private drawGrouping (): void {
    const result = this.grouping?.draw(this.session?.snapshot.currentLevel ?? 2)
    if (!result) return
    this.groupingResult = result
    this.session?.completeGrouping(result.dealerId)
    this.clearNodes(this.groupingNodes)
    const cards = (['p1', 'p2', 'p3', 'p4'] as const).map(id => {
      const card = result.draws[id]
      const suit = card.suit === 'heart' ? '♥' : card.suit === 'diamond' ? '♦' : card.suit === 'spade' ? '♠' : '♣'
      return `${id === 'p1' ? '玩家' : id === 'p2' ? '下家' : id === 'p3' ? '对家' : '上家'}  ${suit}${card.rank}`
    }).join('     ')
    const title = this.makeMenuLabel(`庄家：${result.dealerId === 'p1' ? '玩家' : result.dealerId}`, 0, 160, 36)
    const summary = this.makeMenuLabel(cards, 0, 90, 24)
    const enter = this.addGroupingButton('进入对局', -5, () => this.enterRound())
    this.groupingNodes.push(title.node, summary.node, enter)
  }

  private enterRound (): void {
    this.clearNodes(this.groupingNodes)
    this.setTableVisible(true)
    this.gameManager?.startRound(this.groupingResult?.dealerId)
  }

  private showTutorial (): void {
    this.clearNodes(this.menuNodes)
    this.clearNodes(this.groupingNodes)
    const steps = [
      ['游戏目标', '四人两队、两副牌。尽快出完手牌并与对家配合，争取头游和升级。'],
      ['基本牌型', '单张、对子、三张、三带二、顺子、三连对、钢板、炸弹、同花顺和火箭。'],
      ['逢人配', '当前级别的红桃牌是逢人配，可在组合中充当除大小王外的任意点数。'],
      ['进贡与还贡', '上一局末游向赢家进贡最大牌；赢家还一张不超过 10 的牌。大王可触发抗贡。'],
    ] as const
    const [title, content] = steps[this.tutorialStep]
    const heading = this.makeMenuLabel(`新手教程 · ${this.tutorialStep + 1}/${steps.length}`, 0, 190, 38)
    const titleLabel = this.makeMenuLabel(title, 0, 110, 30)
    const contentLabel = this.makeMenuLabel(content, 0, 45, 22)
    const previous = this.addGroupingButton('上一页', -70, () => { this.tutorialStep = Math.max(0, this.tutorialStep - 1); this.showTutorial() })
    const next = this.addGroupingButton(this.tutorialStep === steps.length - 1 ? '返回主菜单' : '下一页', -140, () => {
      if (this.tutorialStep === steps.length - 1) this.showMenu()
      else { this.tutorialStep += 1; this.showTutorial() }
    })
    previous.setPosition(new Vec3(-145, -70, 0))
    next.setPosition(new Vec3(145, -70, 0))
    this.groupingNodes.push(heading.node, titleLabel.node, contentLabel.node, previous, next)
  }

  private showSettings (): void {
    this.clearNodes(this.menuNodes)
    this.clearNodes(this.groupingNodes)
    const snapshot = this.session?.snapshot
    if (!snapshot) return
    const title = this.makeMenuLabel('游戏设置', 0, 215, 42)
    const state = this.makeMenuLabel(`AI：${snapshot.difficulty}    手牌：${snapshot.settings.sortOrder === 'desc' ? '大牌在左' : '小牌在左'}    规则：${snapshot.settings.rulePreset === 'classic' ? '经典' : '竞技'}\n主题：${snapshot.settings.visualTheme === 'luxury' ? '华丽' : '简洁'}    音效：${snapshot.settings.soundEnabled ? '开' : '关'}    音乐：${snapshot.settings.bgmEnabled ? '开' : '关'}`, 0, 125, 20)
    const difficulty = this.addGroupingButton('切换 AI 难度', 50, () => {
      const levels: Difficulty[] = ['easy', 'medium', 'hard', 'master']
      const current = levels.indexOf(snapshot.difficulty)
      this.session?.setDifficulty(levels[(current + 1) % levels.length])
      this.showSettings()
    })
    const order = this.addGroupingButton('切换手牌排序', -10, () => { this.session?.updateSettings({ sortOrder: snapshot.settings.sortOrder === 'desc' ? 'asc' : 'desc' }); this.showSettings() })
    const rule = this.addGroupingButton('切换规则预设', -70, () => { this.session?.updateSettings({ rulePreset: snapshot.settings.rulePreset === 'classic' ? 'tournament' : 'classic' }); this.showSettings() })
    const theme = this.addGroupingButton('切换视觉主题', -130, () => { this.session?.updateSettings({ visualTheme: snapshot.settings.visualTheme === 'luxury' ? 'compact' : 'luxury' }); this.showSettings() })
    const back = this.addGroupingButton('返回主菜单', -190, () => this.showMenu())
    this.groupingNodes.push(title.node, state.node, difficulty, order, rule, theme, back)
  }

  private setTableVisible (visible: boolean): void {
    [this.hand?.node, this.hintLabel?.node, this.phaseLabel?.node, this.scoreLabel?.node, this.overlayLabel?.node, this.playButton, this.passButton, this.confirmTributeButton, this.finishTributeButton, this.nextRoundButton].forEach(node => { if (node) node.active = visible })
  }

  private clearNodes (nodes: Node[]): void { while (nodes.length) nodes.pop()?.destroy() }

  private makeMenuLabel (text: string, x: number, y: number, fontSize: number): Label {
    const label = this.makeLabel('MenuLabel', x, y, fontSize)
    label.string = text
    label.color = new Color(218, 179, 79)
    return label
  }

  private addMenuButton (text: string, y: number, action: () => void): void {
    const node = this.addGroupingButton(text, y, action)
    this.menuNodes.push(node)
  }

  private addGroupingButton (text: string, y: number, action: () => void): Node {
    const node = this.makeButton('MenuButton', text, 0)
    node.setPosition(new Vec3(0, y, 0))
    node.on(Node.EventType.TOUCH_END, action, this)
    return node
  }

  private makeLabel (name: string, x: number, y: number, fontSize: number): Label {
    const node = new Node(name)
    node.parent = this.node
    node.setPosition(new Vec3(x, y, 0))
    node.addComponent(UITransform).setContentSize(1100, 80)
    const label = node.addComponent(Label)
    label.fontSize = fontSize
    label.lineHeight = fontSize + 8
    label.color = new Color(245, 239, 215)
    label.horizontalAlign = Label.HorizontalAlign.CENTER
    return label
  }

  private makeButton (name: string, text: string, x: number): Node {
    const label = this.makeLabel(name, x, -205, 28)
    const graphics = label.node.addComponent(Graphics)
    graphics.fillColor = new Color(74, 50, 21, 235)
    graphics.strokeColor = new Color(218, 179, 79, 255)
    graphics.lineWidth = 2
    graphics.roundRect(-122, -28, 244, 56, 14)
    graphics.fill()
    graphics.stroke()
    label.string = `【${text}】`
    label.color = new Color(245, 224, 156)
    return label.node
  }
}
