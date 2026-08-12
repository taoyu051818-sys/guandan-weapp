import { Color, EventTouch, Graphics, Label, Node, Sprite, SpriteFrame, Tween, UITransform, Vec3 } from 'cc'
import { TableHudSeatViewGroup } from './TableHudSeatViewGroup'
import { TableHudTurnTimerView } from './TableHudTurnTimerView'
import { renderTableHudCounter, renderTableHudSuits } from './TableHudDynamicRenderer'
import {
  TABLE_GAME_HUD_DESIGN_SIZE,
  TABLE_HUD_TURN_OPERATION_ANCHORS,
  clampTableHudOverlayPosition,
  normalizeTableHudViewport,
  resolveTableHudFrameLayout,
  resolveTableHudOperationRow,
} from './TableHudLayoutPolicy'
import {
  BASE_COUNTER_CLOSED_HEIGHT,
  BASE_COUNTER_OPEN_HEIGHT,
  BASE_COUNTER_WIDTH,
  BASE_TOOLBAR_WIDTH,
  bindTableHudPress,
  configureLabelMetrics,
  configureTransform,
  createTableHudButton,
  createTableHudLabel as createLabel,
  drawTableHudButton,
  drawTableHudPanel as drawPanel,
  EXPANDED_BACK_SIZE,
  EXPANDED_ROUND_HEIGHT,
  EXPANDED_ROUND_WIDTH,
  EXPANDED_SUIT_BAR_HEIGHT,
  EXPANDED_SUIT_BAR_WIDTH,
  EXPANDED_TOOLBAR_HEIGHT,
  EXPANDED_TOOLBAR_WIDTH,
  freshTableGameHudState,
  hitTestVisibleNodes,
  nodeContentSize,
  normalizeAvailableSuits,
  SUITS,
  TABLE_GAME_HUD_COUNTER_RANKS,
} from './TableGameHudFoundation'
import type {
  ButtonView, CounterCell, DraggableOverlay, SuitButtonView,
  TableGameHudActions, TableGameHudCounterRank, TableGameHudState, TableGameHudSuit, TableGameHudViewport,
} from './TableGameHudFoundation'

export { TABLE_GAME_HUD_DESIGN_SIZE }
export { TABLE_GAME_HUD_CARD_COUNTER_STATUS, TABLE_GAME_HUD_COUNTER_RANKS } from './TableGameHudFoundation'
export type {
  TableGameHudActions,
  TableGameHudCounterRank,
  TableGameHudSeatPlace,
  TableGameHudSeatState,
  TableGameHudState,
  TableGameHudSuit,
  TableGameHudViewport,
} from './TableGameHudFoundation'

/**
 * An asset-free table HUD. It owns only presentation state and emits intent
 * callbacks; game rules, networking and card accounting remain authoritative
 * in their respective controllers.
 */
export class TableGameHud {
  private root: Node | null = null
  private state: TableGameHudState = freshTableGameHudState()
  private actions: TableGameHudActions
  private viewport: TableGameHudViewport = TABLE_GAME_HUD_DESIGN_SIZE
  private visible = true

  private roundPanel: Node | null = null
  private roundGraphics: Graphics | null = null
  private roundLabel: Label | null = null
  private levelLabel: Label | null = null
  private backButton: ButtonView | null = null

  private readonly turnTimer = new TableHudTurnTimerView()
  private readonly seats = new TableHudSeatViewGroup()

  private counterPanel: Node | null = null
  private counterGraphics: Graphics | null = null
  private counterTitle: Label | null = null
  private counterToggleLabel: Label | null = null
  private counterHitArea: Node | null = null
  private counterDragHandle: Node | null = null
  private readonly counterCells = new Map<TableGameHudCounterRank, CounterCell>()
  private readonly counterSuitSprites = new Map<TableGameHudSuit, Sprite>()
  private suitBar: Node | null = null
  private suitBarGraphics: Graphics | null = null
  private suitTitleLabel: Label | null = null
  private readonly suitButtons = new Map<TableGameHudSuit, SuitButtonView>()
  private pressedSuit: TableGameHudSuit | null = null
  private operationOverlay: Node | null = null
  private toolbar: Node | null = null
  private turnActionNodes: Node[] = []
  private lockButton: ButtonView | null = null
  private arrangeButton: ButtonView | null = null
  private chatButton: ButtonView | null = null
  private readonly overlayPositions: Partial<Record<DraggableOverlay, Readonly<{ x: number, y: number }>>> = {}
  private activeDrag: DraggableOverlay | null = null

  public constructor (actions: TableGameHudActions = {}) { this.actions = actions }

  public get node (): Node | null { return this.root }

  /** Creates the HUD once and reparents it when called with a different root. */
  public mount (parent: Node): Node {
    if (this.root) {
      this.root.parent = parent
      this.layout(this.viewport)
      return this.root
    }

    const root = new Node('TableGameHud')
    root.parent = parent
    root.active = this.visible
    configureTransform(root, this.viewport.width, this.viewport.height)
    this.root = root

    this.createBackButton(root)
    this.createRoundPanel(root)
    this.turnTimer.mount(root)
    this.createCounter(root)
    this.seats.mount(root)
    this.createSuitBar(root)
    this.createToolbar(root)
    this.applyExpandedHudMetrics()
    this.renderViews()
    this.layout(this.viewport)
    return root
  }

  /** Applies a complete authoritative presentation snapshot. */
  public render (state: TableGameHudState): void {
    const availableSuits = normalizeAvailableSuits(state.availableSuits)
    this.state = {
      ...state,
      cardCounts: { ...state.cardCounts },
      seats: state.seats.map(seat => ({ ...seat })),
      availableSuits,
      selectedSuit: state.selectedSuit && availableSuits.includes(state.selectedSuit) ? state.selectedSuit : null,
    }
    this.renderViews()
    this.layout(this.viewport)
  }

  /** Replaces only provided presentation fields; safe to call before mount. */
  public update (patch: Partial<TableGameHudState>): void {
    const availableSuits = patch.availableSuits
      ? normalizeAvailableSuits(patch.availableSuits)
      : this.state.availableSuits
    const proposedSelectedSuit = patch.selectedSuit !== undefined ? patch.selectedSuit : this.state.selectedSuit
    this.state = {
      ...this.state,
      ...patch,
      cardCounts: patch.cardCounts ? { ...patch.cardCounts } : this.state.cardCounts,
      seats: patch.seats ? patch.seats.map(seat => ({ ...seat })) : this.state.seats,
      availableSuits,
      selectedSuit: proposedSelectedSuit && availableSuits.includes(proposedSelectedSuit) ? proposedSelectedSuit : null,
    }
    this.renderViews()
    if (patch.counterExpanded !== undefined) this.layout(this.viewport)
  }

  public setActions (actions: TableGameHudActions): void { this.actions = actions }

  /** Reparents the authoritative gameplay action buttons without replacing their callbacks or visibility state. */
  public setTurnActionNodes (nodes: readonly (Node | null | undefined)[]): void {
    this.turnActionNodes = nodes.filter((node): node is Node => Boolean(node?.isValid))
    if (this.operationOverlay) {
      this.turnActionNodes.forEach(node => { node.parent = this.operationOverlay })
    }
    this.layout(this.viewport)
  }

  /** Accepts scene-loaded artwork without coupling this presentation module to asset APIs. */
  public setTimerArtwork (artwork: Node | null): void {
    this.turnTimer.setArtwork(artwork)
  }

  public setDefaultAvatarFrame (frame: SpriteFrame | null): void {
    this.seats.setDefaultAvatarFrame(frame)
  }

  /** Reuses the packaged card-suit frames in every HUD surface. */
  public setSuitFrames (frames: Readonly<Partial<Record<TableGameHudSuit, SpriteFrame>>>): void {
    SUITS.forEach(suit => {
      const frame = frames[suit] ?? null
      const buttonSprite = this.suitButtons.get(suit)?.sprite
      if (buttonSprite) buttonSprite.spriteFrame = frame
      const counterSprite = this.counterSuitSprites.get(suit)
      if (counterSprite) counterSprite.spriteFrame = frame
    })
    this.renderSuitButtons()
    this.renderCounter()
  }

  public setVisible (visible: boolean): void {
    this.visible = visible
    if (this.root) this.root.active = visible
  }

  /** Screen-space arbitration for controls intentionally drawn above the hand. */
  public hitTestInteractiveScreenPoint (screenPoint: Readonly<{ x: number, y: number }>): boolean {
    if (!this.visible || !this.root?.activeInHierarchy) return false
    return hitTestVisibleNodes([this.backButton?.node, this.counterPanel, this.suitBar, this.toolbar, this.operationOverlay, this.turnTimer.node], screenPoint)
  }

  /** Applies centered coordinates with independent safe-edge anchoring. */
  public layout (viewport: TableGameHudViewport): void {
    this.viewport = normalizeTableHudViewport(viewport)
    if (!this.root) return

    const layout = resolveTableHudFrameLayout({
      viewport: this.viewport,
      backSize: nodeContentSize(this.backButton?.node, 44, 44),
      roundSize: nodeContentSize(this.roundPanel, 208, 64),
      seatSize: this.seats.getContentSize(),
      suitSize: nodeContentSize(this.suitBar, 382, 54),
      toolbarSize: nodeContentSize(this.toolbar, BASE_TOOLBAR_WIDTH, 56),
    })
    const { bounds } = layout
    configureTransform(this.root, this.viewport.width, this.viewport.height)
    this.root.setPosition(Vec3.ZERO)

    if (this.backButton?.node) this.backButton.node.active = layout.top.back.visible
    if (this.roundPanel) this.roundPanel.active = layout.top.round.visible
    this.place(this.backButton?.node, layout.top.back.x, layout.top.back.y, layout.top.back.scale, 20)
    this.place(this.roundPanel, layout.top.round.x, layout.top.round.y, layout.top.round.scale, 20)

    const counterHeight = this.state.counterExpanded ? BASE_COUNTER_OPEN_HEIGHT : BASE_COUNTER_CLOSED_HEIGHT
    const counterDefault = {
      x: bounds.right - 8 - BASE_COUNTER_WIDTH * bounds.scale / 2,
      y: bounds.top - 8 - counterHeight * bounds.scale / 2,
    }
    const counterPosition = clampTableHudOverlayPosition(
      this.overlayPositions.counter ?? counterDefault,
      { width: BASE_COUNTER_WIDTH, height: counterHeight },
      bounds,
    )
    this.overlayPositions.counter = counterPosition
    this.place(this.counterPanel, counterPosition.x, counterPosition.y, bounds.scale, 80)

    this.seats.layout(layout.seats)
    this.place(this.suitBar, layout.bottom.suitBar.x, layout.bottom.suitBar.y, layout.bottom.suitBar.scale, 20)
    this.place(this.toolbar, layout.bottom.toolbar.x, layout.bottom.toolbar.y, layout.bottom.toolbar.scale, 30)

    const humanTurnTimer = this.state.turnVisible && this.state.turnPlace === 'bottom'
    const timerNode = this.turnTimer.node
    if (timerNode && this.root && this.operationOverlay) {
      const desiredParent = humanTurnTimer ? this.operationOverlay : this.root
      if (timerNode.parent !== desiredParent) timerNode.parent = desiredParent
      timerNode.active = this.state.turnVisible
    }
    const operationSize = this.layoutHumanOperationRow(humanTurnTimer)
    if (!humanTurnTimer && this.state.turnVisible) {
      const timerPosition = clampTableHudOverlayPosition(
        TABLE_HUD_TURN_OPERATION_ANCHORS[this.state.turnPlace],
        { width: 112, height: 112 },
        bounds,
      )
      this.place(timerNode, timerPosition.x, timerPosition.y, bounds.scale, 80)
    }

    const operationPosition = clampTableHudOverlayPosition(
      this.overlayPositions.operations ?? TABLE_HUD_TURN_OPERATION_ANCHORS.bottom,
      operationSize,
      bounds,
    )
    this.overlayPositions.operations = operationPosition
    this.place(this.operationOverlay, operationPosition.x, operationPosition.y, bounds.scale, 80)
    this.operationOverlay?.setSiblingIndex(this.root.children.length - 1)
    if (timerNode?.parent === this.root) timerNode.setSiblingIndex(this.root.children.length - 1)
  }

  public dispose (): void {
    this.seats.dispose()
    this.turnTimer.dispose()
    this.root?.destroy()
    this.root = null
    this.roundPanel = null
    this.roundGraphics = null
    this.roundLabel = null
    this.levelLabel = null
    this.backButton = null
    this.counterPanel = null
    this.counterGraphics = null
    this.counterTitle = null
    this.counterToggleLabel = null
    this.counterHitArea = null
    this.counterDragHandle = null
    this.counterCells.clear()
    this.counterSuitSprites.clear()
    this.suitBar = null
    this.suitBarGraphics = null
    this.suitTitleLabel = null
    this.pressedSuit = null
    this.operationOverlay = null
    this.toolbar = null
    this.turnActionNodes = []
    this.lockButton = null
    this.arrangeButton = null
    this.chatButton = null
    this.suitButtons.clear()
    this.activeDrag = null
  }

  private place (node: Node | undefined | null, x: number, y: number, scale: number, z: number): void {
    if (!node) return
    node.setPosition(new Vec3(x, y, z))
    node.setScale(new Vec3(scale, scale, 1))
  }

  private layoutHumanOperationRow (humanTurnTimer: boolean): Readonly<{ width: number, height: number }> {
    const minimum = { width: 112, height: 112 }
    if (!this.operationOverlay) return minimum
    this.operationOverlay.active = humanTurnTimer
    const timerNode = this.turnTimer.node
    if (!humanTurnTimer || !timerNode) return minimum

    const visibleActions = this.turnActionNodes.filter(node => node.isValid && node.active)
    const row = resolveTableHudOperationRow(visibleActions.map(node => node.getComponent(UITransform)?.contentSize.width ?? 112))
    configureTransform(this.operationOverlay, row.size.width, row.size.height)
    this.place(timerNode, row.timerX, 0, 1, 2)
    visibleActions.forEach((node, index) => {
      Tween.stopAllByTarget(node)
      this.place(node, row.actionXs[index], 0, 1, 3)
    })
    return row.size
  }

  private applyExpandedHudMetrics (): void {
    if (this.backButton) {
      configureTransform(this.backButton.node, EXPANDED_BACK_SIZE, EXPANDED_BACK_SIZE)
      configureLabelMetrics(this.backButton.label, 54, 52, 24, 0, 2)
      this.drawToolButton(this.backButton, false, false)
    }

    if (this.roundPanel) {
      configureTransform(this.roundPanel, EXPANDED_ROUND_WIDTH, EXPANDED_ROUND_HEIGHT)
      configureLabelMetrics(this.roundLabel, 252, 40, 30, 0, 19)
      configureLabelMetrics(this.levelLabel, 258, 34, 26, 0, -21)
      if (this.roundGraphics) drawPanel(this.roundGraphics, EXPANDED_ROUND_WIDTH, EXPANDED_ROUND_HEIGHT, EXPANDED_ROUND_HEIGHT / 2)
    }

    if (this.suitBar) configureTransform(this.suitBar, EXPANDED_SUIT_BAR_WIDTH, EXPANDED_SUIT_BAR_HEIGHT)
    configureLabelMetrics(this.suitTitleLabel, 126, 52, 28, -174, 0)
    this.suitButtons.forEach((view, suit) => {
      const index = SUITS.indexOf(suit)
      configureTransform(view.node, 62, 58)
      view.node.setPosition(new Vec3(-66 + index * 70, 0, 2))
      configureTransform(view.sprite.node, 43, 43)
      view.sprite.node.setPosition(Vec3.ZERO)
    })

    if (this.toolbar) configureTransform(this.toolbar, EXPANDED_TOOLBAR_WIDTH, EXPANDED_TOOLBAR_HEIGHT)
    this.configureToolbarButton(this.lockButton, -190, 150, 64, 30)
    this.configureToolbarButton(this.arrangeButton, 0, 210, 64, 32)
    this.configureToolbarButton(this.chatButton, 190, 150, 64, 30)

  }

  private configureToolbarButton (view: ButtonView | null, x: number, width: number, height: number, fontSize: number): void {
    if (!view) return
    configureTransform(view.node, width, height)
    view.node.setPosition(new Vec3(x, 0, 1))
    configureLabelMetrics(view.label, width - 20, height - 10, fontSize, 0, 0)
    this.drawToolButton(view, false, false)
  }

  private createRoundPanel (parent: Node): void {
    const node = new Node('MatchSummary')
    node.parent = parent
    configureTransform(node, 208, 64)
    this.roundGraphics = node.addComponent(Graphics)
    this.roundLabel = createLabel(node, 'RoundLabel', 188, 30, 22, new Color(239, 248, 247), 0, 14)
    this.levelLabel = createLabel(node, 'TeamLevelLabel', 198, 27, 20, new Color(255, 205, 77), 0, -15)
    this.roundPanel = node
  }

  private createBackButton (parent: Node): void {
    const button = this.createButton(parent, 'TableBack', '返回', 0, 60, 44, 22)
    this.bindPress(button.node, pressed => this.drawToolButton(button, false, pressed), () => this.actions.onBack?.())
    this.backButton = button
  }

  private createCounter (parent: Node): void {
    const panel = new Node('CardCounter')
    panel.parent = parent
    configureTransform(panel, BASE_COUNTER_WIDTH, BASE_COUNTER_OPEN_HEIGHT)
    this.counterGraphics = panel.addComponent(Graphics)
    this.counterTitle = createLabel(panel, 'CounterTitle', 66, 30, 20, new Color(244, 248, 239), -264, 18)
    this.counterTitle.string = '记牌器'
    this.counterToggleLabel = createLabel(panel, 'CounterToggle', 54, 38, 20, new Color(255, 205, 77), 270, 0)

    SUITS.forEach((suit, index) => {
      const node = new Node(`CounterSuit-${suit}`)
      node.parent = panel
      node.setPosition(new Vec3(-286 + index * 15, -18, 3))
      configureTransform(node, 14, 14)
      const sprite = node.addComponent(Sprite)
      sprite.type = Sprite.Type.SIMPLE
      sprite.sizeMode = Sprite.SizeMode.CUSTOM
      this.counterSuitSprites.set(suit, sprite)
    })

    const dragHandle = new Node('CounterDragHandle')
    dragHandle.parent = panel
    dragHandle.setPosition(new Vec3(-264, 0, 4))
    configureTransform(dragHandle, 68, BASE_COUNTER_OPEN_HEIGHT)
    this.bindDragHandle(dragHandle, 'counter')
    this.counterDragHandle = dragHandle

    TABLE_GAME_HUD_COUNTER_RANKS.forEach((rank, index) => {
      const x = -218 + index * 31.5
      const rankLabel = createLabel(panel, `CounterRank-${rank}`, 30, 28, 20, new Color(236, 244, 241), x, 15)
      const countLabel = createLabel(panel, `CounterCount-${rank}`, 30, 28, 20, new Color(218, 235, 231), x, -15)
      this.counterCells.set(rank, { rankLabel, countLabel })
    })

    const hitArea = new Node('CounterToggleHitArea')
    hitArea.parent = panel
    hitArea.setPosition(new Vec3(270, 0, 4))
    configureTransform(hitArea, 58, 42)
    this.bindPress(hitArea, () => {}, () => {
      const expanded = !this.state.counterExpanded
      this.update({ counterExpanded: expanded })
      this.actions.onCounterVisibilityChange?.(expanded)
    })
    this.counterHitArea = hitArea
    this.counterPanel = panel
  }

  private createSuitBar (parent: Node): void {
    const bar = new Node('StraightFlushSuitBar')
    bar.parent = parent
    configureTransform(bar, 382, 54)
    this.suitBarGraphics = bar.addComponent(Graphics)
    const title = createLabel(bar, 'SuitBarTitle', 102, 38, 22, new Color(235, 243, 237), -138, 0)
    title.string = '同花顺'
    title.isBold = true
    this.suitTitleLabel = title

    SUITS.forEach((suit, index) => {
      const node = new Node(`Suit-${suit}`)
      node.parent = bar
      node.setPosition(new Vec3(-48 + index * 58, 0, 2))
      configureTransform(node, 48, 42)
      const spriteNode = new Node('SuitArtwork')
      spriteNode.parent = node
      configureTransform(spriteNode, 36, 36)
      const sprite = spriteNode.addComponent(Sprite)
      sprite.type = Sprite.Type.SIMPLE
      sprite.sizeMode = Sprite.SizeMode.CUSTOM
      this.bindPress(node, pressed => {
        this.pressedSuit = pressed ? suit : null
        this.renderSuitButtons()
      }, () => {
        if (!this.isSuitAvailable(suit)) return
        const selected = this.state.selectedSuit === suit ? null : suit
        this.update({ selectedSuit: selected })
        this.actions.onSuitSelect?.(selected)
      })
      this.suitButtons.set(suit, { node, sprite })
    })
    this.suitBar = bar
  }

  private createToolbar (parent: Node): void {
    const overlay = new Node('FloatingOperationGroup')
    overlay.parent = parent
    configureTransform(overlay, 112, 112)
    this.operationOverlay = overlay
    if (this.turnTimer.node) {
      this.bindDragHandle(this.turnTimer.node, 'operations', () => this.turnTimer.node?.parent === this.operationOverlay)
    }

    const toolbar = new Node('BottomTableToolbar')
    toolbar.parent = parent
    configureTransform(toolbar, BASE_TOOLBAR_WIDTH, 56)
    this.lockButton = this.createButton(toolbar, 'LockHand', '锁牌', -150, 116, 50, 24)
    this.arrangeButton = this.createButton(toolbar, 'ArrangeHand', '一键理牌', 0, 164, 50, 26)
    this.chatButton = this.createButton(toolbar, 'QuickChat', '快捷语', 150, 116, 50, 24)

    this.bindPress(
      this.lockButton.node,
      pressed => this.drawToolButton(this.lockButton, this.state.lockAction !== 'start', pressed),
      () => this.actions.onHandLockAction?.(),
    )
    this.bindPress(this.arrangeButton.node, pressed => this.drawToolButton(this.arrangeButton, false, pressed), () => this.actions.onArrange?.())
    this.bindPress(this.chatButton.node, pressed => this.drawToolButton(this.chatButton, false, pressed), () => this.actions.onChat?.())
    this.toolbar = toolbar
  }

  private bindDragHandle (handle: Node, overlay: DraggableOverlay, canStart: () => boolean = () => true): void {
    handle.on(Node.EventType.TOUCH_START, () => { if (canStart()) this.activeDrag = overlay })
    handle.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      if (this.activeDrag !== overlay) return
      const target = overlay === 'counter' ? this.counterPanel : this.operationOverlay
      if (!target) return
      const delta = event.getUIDelta()
      const current = target.position
      this.overlayPositions[overlay] = { x: current.x + delta.x, y: current.y + delta.y }
      this.layout(this.viewport)
    })
    const finish = (): void => { if (this.activeDrag === overlay) this.activeDrag = null }
    handle.on(Node.EventType.TOUCH_END, finish)
    handle.on(Node.EventType.TOUCH_CANCEL, finish)
  }

  private createButton (parent: Node, name: string, text: string, x: number, width: number, height: number, fontSize: number): ButtonView {
    return createTableHudButton(parent, name, text, x, width, height, fontSize)
  }

  private bindPress (node: Node, redraw: (pressed: boolean) => void, activate: () => void): void {
    bindTableHudPress(node, redraw, activate)
  }

  private renderViews (): void {
    if (!this.root) return
    if (this.roundLabel) this.roundLabel.string = this.state.matchLabel
    if (this.levelLabel) this.levelLabel.string = this.state.levelLabel
    this.turnTimer.render(this.state)
    this.renderCounter()
    this.seats.render(this.state.seats)
    this.renderSuitButtons()
    if (this.lockButton) {
      const labels = { start: '锁牌', cancel: '取消', commit: '确认', unlock: '解锁' } as const
      this.lockButton.label.string = labels[this.state.lockAction]
      this.drawToolButton(this.lockButton, this.state.lockAction !== 'start', false)
    }
    if (this.arrangeButton) this.arrangeButton.label.string = this.state.arrangeRestoreAvailable ? '复原' : '一键理牌'
  }

  private renderCounter (): void {
    renderTableHudCounter({
      panel: this.counterPanel, graphics: this.counterGraphics, title: this.counterTitle,
      toggleLabel: this.counterToggleLabel, hitArea: this.counterHitArea, dragHandle: this.counterDragHandle,
      cells: this.counterCells, suitSprites: this.counterSuitSprites, state: this.state,
    })
  }

  private isSuitAvailable (suit: TableGameHudSuit): boolean {
    return this.state.availableSuits.includes(suit)
  }

  private renderSuitButtons (): void {
    renderTableHudSuits({
      bar: this.suitBar, graphics: this.suitBarGraphics, buttons: this.suitButtons,
      availableSuits: this.state.availableSuits, selectedSuit: this.state.selectedSuit, pressedSuit: this.pressedSuit,
    })
  }

  private drawToolButton (view: ButtonView | null, active: boolean, pressed: boolean): void {
    drawTableHudButton(view, active, pressed)
  }
}
