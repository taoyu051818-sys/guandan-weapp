import { Color, EventTouch, Graphics, Label, Node, Sprite, SpriteFrame, Tween, UITransform, Vec3 } from 'cc'
import { resolveSafePriorityRects } from './SafeAreaLayout'
import { applyForegroundTextStyle } from './RuntimeUiFactory'

export const TABLE_GAME_HUD_DESIGN_SIZE = Object.freeze({ width: 1280, height: 720 })
export const TABLE_GAME_HUD_COUNTER_RANKS = ['大王', '小王', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'] as const

export type TableGameHudCounterRank = typeof TABLE_GAME_HUD_COUNTER_RANKS[number]
export type TableGameHudSeatPlace = 'bottom' | 'right' | 'top' | 'left'
export type TableGameHudSuit = 'spade' | 'heart' | 'club' | 'diamond'

export type TableGameHudViewport = Readonly<{
  width: number
  height: number
  safeLeft?: number
  safeRight?: number
  safeTop?: number
  safeBottom?: number
}>

export type TableGameHudSeatState = Readonly<{
  place: TableGameHudSeatPlace
  name: string
  status: string
  avatarText?: string
  active?: boolean
  offline?: boolean
}>

export type TableGameHudState = Readonly<{
  matchLabel: string
  levelLabel: string
  turnVisible: boolean
  turnSeconds: number
  turnDurationSeconds: number
  turnPlace: TableGameHudSeatPlace
  counterExpanded: boolean
  cardCounts: Readonly<Partial<Record<TableGameHudCounterRank, number>>>
  seats: readonly TableGameHudSeatState[]
  availableSuits: readonly TableGameHudSuit[]
  selectedSuit: TableGameHudSuit | null
  handLocked: boolean
  arrangeRestoreAvailable: boolean
}>

export type TableGameHudActions = Readonly<{
  onBack?: () => void
  onCounterVisibilityChange?: (expanded: boolean) => void
  onSuitSelect?: (suit: TableGameHudSuit | null) => void
  onHandLockChange?: (locked: boolean) => void
  onArrange?: () => void
  onChat?: () => void
}>

type SeatView = {
  node: Node
  graphics: Graphics
  avatarSprite: Sprite
  nameLabel: Label
  rankLabel: Label
}

type CounterCell = {
  rankLabel: Label
  countLabel: Label
}

type ButtonView = {
  node: Node
  graphics: Graphics
  label: Label
}

type SuitButtonView = {
  node: Node
  label: Label
}

type HudLayout = {
  scale: number
  left: number
  right: number
  top: number
  bottom: number
}

const BASE_COUNTER_WIDTH = 596
const BASE_COUNTER_OPEN_HEIGHT = 76
const BASE_COUNTER_CLOSED_HEIGHT = 38
const SEAT_PLACES: readonly TableGameHudSeatPlace[] = ['bottom', 'right', 'top', 'left']
const SUITS: readonly TableGameHudSuit[] = ['spade', 'heart', 'club', 'diamond']
const SUIT_TEXT: Readonly<Record<TableGameHudSuit, string>> = Object.freeze({ spade: '♠', heart: '♥', club: '♣', diamond: '♦' })
const DEFAULT_SEAT_NAMES: Readonly<Record<TableGameHudSeatPlace, string>> = Object.freeze({ bottom: '我', right: '下家', top: '对家', left: '上家' })
const AVATAR_COLORS: Readonly<Record<TableGameHudSeatPlace, Color>> = Object.freeze({
  bottom: new Color(64, 168, 177),
  right: new Color(211, 117, 72),
  top: new Color(124, 119, 201),
  left: new Color(91, 157, 105),
})
const TURN_OPERATION_ANCHORS: Readonly<Record<TableGameHudSeatPlace, Readonly<{ x: number, y: number }>>> = Object.freeze({
  bottom: Object.freeze({ x: 0, y: -82 }),
  right: Object.freeze({ x: 300, y: 0 }),
  top: Object.freeze({ x: 0, y: 218 }),
  left: Object.freeze({ x: -300, y: 0 }),
})

type DraggableOverlay = 'counter' | 'operations'

const freshState = (): TableGameHudState => ({
  matchLabel: '本局打 2',
  levelLabel: '我方 2级 · 对方 2级',
  turnVisible: true,
  turnSeconds: 15,
  turnDurationSeconds: 15,
  turnPlace: 'bottom',
  counterExpanded: true,
  cardCounts: {},
  seats: SEAT_PLACES.map(place => ({ place, name: DEFAULT_SEAT_NAMES[place], status: '剩27张' })),
  availableSuits: [],
  selectedSuit: null,
  handLocked: false,
  arrangeRestoreAvailable: false,
})

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))

const finiteOr = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? Number(value) : fallback

const normalizeAvailableSuits = (suits: readonly TableGameHudSuit[] | undefined): readonly TableGameHudSuit[] => {
  const requested = new Set(suits ?? [])
  return SUITS.filter(suit => requested.has(suit))
}

const configureTransform = (node: Node, width: number, height: number): UITransform => {
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform)
  transform.setContentSize(width, height)
  return transform
}

const createLabel = (
  parent: Node,
  name: string,
  width: number,
  height: number,
  fontSize: number,
  color: Color,
  x = 0,
  y = 0,
): Label => {
  const node = new Node(name)
  node.parent = parent
  node.setPosition(new Vec3(x, y, 1))
  configureTransform(node, width, height)
  const label = node.addComponent(Label)
  label.fontSize = fontSize
  label.lineHeight = fontSize + 5
  label.overflow = Label.Overflow.SHRINK
  label.horizontalAlign = Label.HorizontalAlign.CENTER
  label.verticalAlign = Label.VerticalAlign.CENTER
  label.color = color
  label.string = ''
  return applyForegroundTextStyle(label, new Color(18, 38, 43, 255), fontSize <= 14 ? 1 : 2)
}

const drawPanel = (graphics: Graphics, width: number, height: number, radius = 8, active = false): void => {
  graphics.clear()
  graphics.fillColor = active ? new Color(25, 68, 78, 242) : new Color(10, 34, 48, 225)
  graphics.strokeColor = active ? new Color(245, 198, 77, 255) : new Color(101, 179, 194, 215)
  graphics.lineWidth = active ? 2.5 : 1.5
  graphics.roundRect(-width / 2, -height / 2, width, height, radius)
  graphics.fill()
  graphics.stroke()
}

/**
 * An asset-free table HUD. It owns only presentation state and emits intent
 * callbacks; game rules, networking and card accounting remain authoritative
 * in their respective controllers.
 */
export class TableGameHud {
  private root: Node | null = null
  private state: TableGameHudState = freshState()
  private actions: TableGameHudActions
  private viewport: TableGameHudViewport = TABLE_GAME_HUD_DESIGN_SIZE
  private visible = true

  private roundPanel: Node | null = null
  private roundLabel: Label | null = null
  private levelLabel: Label | null = null
  private backButton: ButtonView | null = null

  private timerNode: Node | null = null
  private timerGraphics: Graphics | null = null
  private timerArtwork: Node | null = null
  private timerLabel: Label | null = null
  private defaultAvatarFrame: SpriteFrame | null = null

  private counterPanel: Node | null = null
  private counterGraphics: Graphics | null = null
  private counterTitle: Label | null = null
  private counterToggleLabel: Label | null = null
  private counterHitArea: Node | null = null
  private counterDragHandle: Node | null = null
  private readonly counterCells = new Map<TableGameHudCounterRank, CounterCell>()

  private readonly seatViews = new Map<TableGameHudSeatPlace, SeatView>()
  private suitBar: Node | null = null
  private suitBarGraphics: Graphics | null = null
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
    this.createTimer(root)
    this.createCounter(root)
    this.createSeats(root)
    this.createSuitBar(root)
    this.createToolbar(root)
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
    if (this.timerArtwork && this.timerArtwork !== artwork) this.timerArtwork.destroy()
    this.timerArtwork = artwork
    if (artwork && this.timerNode) {
      artwork.parent = this.timerNode
      artwork.setPosition(new Vec3(0, 2, -2))
      artwork.setSiblingIndex(0)
    }
    this.renderTimer()
  }

  public setDefaultAvatarFrame (frame: SpriteFrame | null): void {
    this.defaultAvatarFrame = frame
    this.seatViews.forEach(view => {
      view.avatarSprite.spriteFrame = frame
      view.avatarSprite.node.active = Boolean(frame)
    })
  }

  public setVisible (visible: boolean): void {
    this.visible = visible
    if (this.root) this.root.active = visible
  }

  /** Applies centered coordinates with independent safe-edge anchoring. */
  public layout (viewport: TableGameHudViewport): void {
    this.viewport = {
      width: Math.max(1, finiteOr(viewport.width, TABLE_GAME_HUD_DESIGN_SIZE.width)),
      height: Math.max(1, finiteOr(viewport.height, TABLE_GAME_HUD_DESIGN_SIZE.height)),
      safeLeft: Math.max(0, finiteOr(viewport.safeLeft, 0)),
      safeRight: Math.max(0, finiteOr(viewport.safeRight, 0)),
      safeTop: Math.max(0, finiteOr(viewport.safeTop, 0)),
      safeBottom: Math.max(0, finiteOr(viewport.safeBottom, 0)),
    }
    if (!this.root) return

    const layout = this.resolveLayout(this.viewport)
    configureTransform(this.root, this.viewport.width, this.viewport.height)
    this.root.setPosition(Vec3.ZERO)

    const counterHeight = this.state.counterExpanded ? BASE_COUNTER_OPEN_HEIGHT : BASE_COUNTER_CLOSED_HEIGHT
    const topPlacements = resolveSafePriorityRects({ left: layout.left + 8, right: layout.right - 8, top: layout.top - 6, bottom: layout.bottom + 8 }, [
      { id: 'back', x: layout.left + 32 * layout.scale, y: layout.top - 38 * layout.scale, width: 44 * layout.scale, height: 44 * layout.scale, priority: 90, canHide: false },
      { id: 'round', x: layout.left + 163 * layout.scale, y: layout.top - 38 * layout.scale, width: 208 * layout.scale, height: 64 * layout.scale, priority: 60, shiftAxis: 'x', shiftStep: 20 * layout.scale, maxShift: 100 * layout.scale },
    ], 4)
    const topPlace = (id: string) => topPlacements.find(item => item.id === id)
    const back = topPlace('back')
    const round = topPlace('round')
    if (this.backButton?.node && back) this.backButton.node.active = back.visible
    if (this.roundPanel && round) this.roundPanel.active = round.visible
    this.place(this.backButton?.node, back?.x ?? 0, back?.y ?? 0, layout.scale, 20)
    this.place(this.roundPanel, round?.x ?? 0, round?.y ?? 0, layout.scale, 20)

    // Floating HUD groups are clamped independently and never displace lower
    // seats, play areas or hand controls through safe-layout collision rules.
    const counterDefault = {
      x: layout.right - BASE_COUNTER_WIDTH * layout.scale / 2,
      y: layout.top - counterHeight * layout.scale / 2,
    }
    const counterPosition = this.clampOverlayPosition(this.overlayPositions.counter ?? counterDefault, BASE_COUNTER_WIDTH, counterHeight, layout)
    this.overlayPositions.counter = counterPosition
    if (this.counterPanel) this.counterPanel.active = true
    this.place(this.counterPanel, counterPosition.x, counterPosition.y, layout.scale, 80)

    const turnAnchor = TURN_OPERATION_ANCHORS[this.state.turnPlace]
    const operationPlacements = resolveSafePriorityRects({ left: layout.left + 8, right: layout.right - 8, top: layout.top - 8, bottom: layout.bottom + 8 }, [
      { id: 'seat-top', x: -220, y: TURN_OPERATION_ANCHORS.top.y, width: 190 * layout.scale, height: 70 * layout.scale, priority: 80, shiftAxis: 'x' as const, shiftStep: 16 * layout.scale, maxShift: 160 * layout.scale, canHide: false },
      { id: 'seat-bottom', x: layout.left + 100 * layout.scale, y: layout.bottom + 86 * layout.scale, width: 190 * layout.scale, height: 70 * layout.scale, priority: 75, shiftAxis: 'x' as const, shiftStep: 16 * layout.scale, maxShift: 160 * layout.scale, canHide: false },
      { id: 'seat-right', x: layout.right - 100 * layout.scale, y: 16, width: 190 * layout.scale, height: 70 * layout.scale, priority: 70, shiftAxis: 'y' as const, shiftStep: 18 * layout.scale, maxShift: 216 * layout.scale, canHide: false },
      { id: 'seat-left', x: layout.left + 100 * layout.scale, y: 16, width: 190 * layout.scale, height: 70 * layout.scale, priority: 70, shiftAxis: 'y' as const, shiftStep: 18 * layout.scale, maxShift: 216 * layout.scale, canHide: false },
    ], 4)
    const operationPlace = (id: string) => operationPlacements.find(item => item.id === id)
    const bottomSeat = operationPlace('seat-bottom')
    const rightSeat = operationPlace('seat-right')
    const topSeat = operationPlace('seat-top')
    const leftSeat = operationPlace('seat-left')
    this.place(this.seatViews.get('bottom')?.node, bottomSeat?.x ?? layout.left + 100 * layout.scale, bottomSeat?.y ?? layout.bottom + 86 * layout.scale, layout.scale, 10)
    this.place(this.seatViews.get('right')?.node, rightSeat?.x ?? layout.right - 100 * layout.scale, rightSeat?.y ?? 16, layout.scale, 10)
    this.place(this.seatViews.get('top')?.node, topSeat?.x ?? -220, topSeat?.y ?? TURN_OPERATION_ANCHORS.top.y, layout.scale, 10)
    this.place(this.seatViews.get('left')?.node, leftSeat?.x ?? layout.left + 100 * layout.scale, leftSeat?.y ?? 16, layout.scale, 10)

    this.place(this.suitBar, 0, layout.bottom + 28 * layout.scale, layout.scale, 20)
    this.place(this.toolbar, layout.right - 175 * layout.scale, layout.bottom + 28 * layout.scale, layout.scale, 30)

    const humanTurnTimer = this.state.turnVisible && this.state.turnPlace === 'bottom'
    if (this.timerNode && this.root && this.operationOverlay) {
      const desiredParent = humanTurnTimer ? this.operationOverlay : this.root
      if (this.timerNode.parent !== desiredParent) this.timerNode.parent = desiredParent
      this.timerNode.active = this.state.turnVisible
    }
    const operationSize = this.layoutHumanOperationRow(humanTurnTimer)
    if (!humanTurnTimer && this.state.turnVisible) {
      const timerPosition = this.clampOverlayPosition(turnAnchor, 112, 112, layout)
      this.place(this.timerNode, timerPosition.x, timerPosition.y, layout.scale, 80)
    }

    const operationDefault = {
      x: TURN_OPERATION_ANCHORS.bottom.x,
      y: TURN_OPERATION_ANCHORS.bottom.y,
    }
    const operationPosition = this.clampOverlayPosition(this.overlayPositions.operations ?? operationDefault, operationSize.width, operationSize.height, layout)
    this.overlayPositions.operations = operationPosition
    this.place(this.operationOverlay, operationPosition.x, operationPosition.y, layout.scale, 80)
    this.counterPanel?.setSiblingIndex(this.root.children.length - 1)
    this.operationOverlay?.setSiblingIndex(this.root.children.length - 1)
    if (this.timerNode?.parent === this.root) this.timerNode.setSiblingIndex(this.root.children.length - 1)
  }

  public dispose (): void {
    this.root?.destroy()
    this.root = null
    this.roundPanel = null
    this.roundLabel = null
    this.levelLabel = null
    this.backButton = null
    this.timerNode = null
    this.timerGraphics = null
    this.timerArtwork = null
    this.timerLabel = null
    this.counterPanel = null
    this.counterGraphics = null
    this.counterTitle = null
    this.counterToggleLabel = null
    this.counterHitArea = null
    this.counterDragHandle = null
    this.suitBar = null
    this.suitBarGraphics = null
    this.pressedSuit = null
    this.operationOverlay = null
    this.toolbar = null
    this.turnActionNodes = []
    this.lockButton = null
    this.arrangeButton = null
    this.chatButton = null
    this.seatViews.clear()
    this.suitButtons.clear()
    this.counterCells.clear()
    this.activeDrag = null
  }

  private resolveLayout (viewport: TableGameHudViewport): HudLayout {
    const safeLeft = viewport.safeLeft ?? 0
    const safeRight = viewport.safeRight ?? 0
    const safeTop = viewport.safeTop ?? 0
    const safeBottom = viewport.safeBottom ?? 0
    const safeWidth = Math.max(1, viewport.width - safeLeft - safeRight)
    const safeHeight = Math.max(1, viewport.height - safeTop - safeBottom)
    const fit = Math.min(safeWidth / TABLE_GAME_HUD_DESIGN_SIZE.width, safeHeight / TABLE_GAME_HUD_DESIGN_SIZE.height)
    return {
      scale: clamp(fit, 0.55, 1.4),
      left: -viewport.width / 2 + safeLeft,
      right: viewport.width / 2 - safeRight,
      top: viewport.height / 2 - safeTop,
      bottom: -viewport.height / 2 + safeBottom,
    }
  }

  private place (node: Node | undefined | null, x: number, y: number, scale: number, z: number): void {
    if (!node) return
    node.setPosition(new Vec3(x, y, z))
    node.setScale(new Vec3(scale, scale, 1))
  }

  private clampOverlayPosition (
    position: Readonly<{ x: number, y: number }>,
    width: number,
    height: number,
    layout: HudLayout,
  ): Readonly<{ x: number, y: number }> {
    const halfWidth = width * layout.scale / 2
    const halfHeight = height * layout.scale / 2
    const left = layout.left + 8 + halfWidth
    const right = layout.right - 8 - halfWidth
    const bottom = layout.bottom + 8 + halfHeight
    const top = layout.top - 8 - halfHeight
    return {
      x: left <= right ? clamp(position.x, left, right) : (layout.left + layout.right) / 2,
      y: bottom <= top ? clamp(position.y, bottom, top) : (layout.bottom + layout.top) / 2,
    }
  }

  private layoutHumanOperationRow (humanTurnTimer: boolean): Readonly<{ width: number, height: number }> {
    const minimum = { width: 112, height: 112 }
    if (!this.operationOverlay) return minimum
    this.operationOverlay.active = humanTurnTimer
    if (!humanTurnTimer || !this.timerNode) return minimum

    const visibleActions = this.turnActionNodes.filter(node => node.isValid && node.active)
    const timerWidth = 112
    const gap = 10
    const actionWidths = visibleActions.map(node => Math.max(72, node.getComponent(UITransform)?.contentSize.width ?? 112))
    const width = timerWidth + actionWidths.reduce((sum, value) => sum + value, 0) + gap * visibleActions.length
    configureTransform(this.operationOverlay, width, minimum.height)

    let cursor = -width / 2
    this.place(this.timerNode, cursor + timerWidth / 2, 0, 1, 2)
    cursor += timerWidth + gap
    visibleActions.forEach((node, index) => {
      const actionWidth = actionWidths[index]
      Tween.stopAllByTarget(node)
      this.place(node, cursor + actionWidth / 2, 0, 1, 3)
      cursor += actionWidth + (index < visibleActions.length - 1 ? gap : 0)
    })
    return { width, height: minimum.height }
  }

  private createRoundPanel (parent: Node): void {
    const node = new Node('MatchSummary')
    node.parent = parent
    configureTransform(node, 208, 64)
    this.roundLabel = createLabel(node, 'RoundLabel', 188, 28, 19, new Color(239, 248, 247), 0, 14)
    this.levelLabel = createLabel(node, 'TeamLevelLabel', 198, 25, 17, new Color(255, 205, 77), 0, -15)
    this.roundPanel = node
  }

  private createBackButton (parent: Node): void {
    const button = this.createButton(parent, 'TableBack', '‹', 0, 44, 44, 30)
    this.bindPress(button.node, pressed => this.drawToolButton(button, false, pressed), () => this.actions.onBack?.())
    this.backButton = button
  }

  private createTimer (parent: Node): void {
    const node = new Node('CircularTurnTimer')
    node.parent = parent
    configureTransform(node, 112, 112)
    this.timerGraphics = node.addComponent(Graphics)
    this.timerLabel = createLabel(node, 'TurnSeconds', 62, 48, 30, new Color(255, 255, 255), 0, 0)
    this.timerNode = node
  }

  private createCounter (parent: Node): void {
    const panel = new Node('CardCounter')
    panel.parent = parent
    configureTransform(panel, BASE_COUNTER_WIDTH, BASE_COUNTER_OPEN_HEIGHT)
    this.counterGraphics = panel.addComponent(Graphics)
    this.counterTitle = createLabel(panel, 'CounterTitle', 64, 42, 15, new Color(244, 248, 239), -264, 0)
    this.counterTitle.string = '记牌器'
    this.counterToggleLabel = createLabel(panel, 'CounterToggle', 48, 38, 13, new Color(255, 205, 77), 270, 0)

    const dragHandle = new Node('CounterDragHandle')
    dragHandle.parent = panel
    dragHandle.setPosition(new Vec3(-264, 0, 4))
    configureTransform(dragHandle, 68, BASE_COUNTER_OPEN_HEIGHT)
    this.bindDragHandle(dragHandle, 'counter')
    this.counterDragHandle = dragHandle

    TABLE_GAME_HUD_COUNTER_RANKS.forEach((rank, index) => {
      const x = -218 + index * 31.5
      const rankLabel = createLabel(panel, `CounterRank-${rank}`, 30, 25, rank.length > 1 ? 12 : 14, new Color(236, 244, 241), x, 14)
      const countLabel = createLabel(panel, `CounterCount-${rank}`, 30, 25, 14, new Color(218, 235, 231), x, -14)
      this.counterCells.set(rank, { rankLabel, countLabel })
    })

    const hitArea = new Node('CounterToggleHitArea')
    hitArea.parent = panel
    hitArea.setPosition(new Vec3(270, 0, 4))
    configureTransform(hitArea, 52, 38)
    this.bindPress(hitArea, () => {}, () => {
      const expanded = !this.state.counterExpanded
      this.update({ counterExpanded: expanded })
      this.actions.onCounterVisibilityChange?.(expanded)
    })
    this.counterHitArea = hitArea
    this.counterPanel = panel
  }

  private createSeats (parent: Node): void {
    SEAT_PLACES.forEach(place => {
      const node = new Node(`Seat-${place}`)
      node.parent = parent
      configureTransform(node, 190, 70)
      const graphics = node.addComponent(Graphics)
      const avatarNode = new Node('DefaultAvatar')
      avatarNode.parent = node
      avatarNode.setPosition(new Vec3(-58, 0, 2))
      configureTransform(avatarNode, 46, 46)
      const avatarSprite = avatarNode.addComponent(Sprite)
      avatarSprite.sizeMode = Sprite.SizeMode.CUSTOM
      avatarSprite.node.active = false
      const nameLabel = createLabel(node, 'PlayerName', 112, 25, 17, new Color(240, 246, 243), 29, 15)
      const rankLabel = createLabel(node, 'PlayerRank', 104, 20, 12, new Color(255, 216, 105), 34, -14)
      this.seatViews.set(place, { node, graphics, avatarSprite, nameLabel, rankLabel })
    })
  }

  private createSuitBar (parent: Node): void {
    const bar = new Node('StraightFlushSuitBar')
    bar.parent = parent
    configureTransform(bar, 382, 54)
    this.suitBarGraphics = bar.addComponent(Graphics)
    const title = createLabel(bar, 'SuitBarTitle', 96, 36, 18, new Color(235, 243, 237), -138, 0)
    title.string = '同花顺'
    title.isBold = true

    SUITS.forEach((suit, index) => {
      const node = new Node(`Suit-${suit}`)
      node.parent = bar
      node.setPosition(new Vec3(-48 + index * 58, 0, 2))
      configureTransform(node, 48, 42)
      const label = createLabel(node, 'Label', 44, 40, 29, new Color(227, 239, 235))
      label.string = SUIT_TEXT[suit]
      label.isBold = true
      applyForegroundTextStyle(label, new Color(9, 27, 32, 255), 3)
      this.bindPress(node, pressed => {
        this.pressedSuit = pressed ? suit : null
        this.renderSuitButtons()
      }, () => {
        if (!this.isSuitAvailable(suit)) return
        const selected = this.state.selectedSuit === suit ? null : suit
        this.update({ selectedSuit: selected })
        this.actions.onSuitSelect?.(selected)
      })
      this.suitButtons.set(suit, { node, label })
    })
    this.suitBar = bar
  }

  private createToolbar (parent: Node): void {
    const overlay = new Node('FloatingOperationGroup')
    overlay.parent = parent
    configureTransform(overlay, 112, 112)
    this.operationOverlay = overlay
    if (this.timerNode) {
      this.bindDragHandle(this.timerNode, 'operations', () => this.timerNode?.parent === this.operationOverlay)
    }

    const toolbar = new Node('BottomTableToolbar')
    toolbar.parent = parent
    configureTransform(toolbar, 350, 48)
    this.lockButton = this.createButton(toolbar, 'LockHand', '锁牌', -118, 98, 42, 16)
    this.arrangeButton = this.createButton(toolbar, 'ArrangeHand', '一键理牌', 0, 122, 42, 16)
    this.chatButton = this.createButton(toolbar, 'QuickChat', '快捷语', 118, 92, 42, 16)

    this.bindPress(this.lockButton.node, pressed => this.drawToolButton(this.lockButton, this.state.handLocked, pressed), () => {
      const locked = !this.state.handLocked
      this.update({ handLocked: locked })
      this.actions.onHandLockChange?.(locked)
    })
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
    const node = new Node(name)
    node.parent = parent
    node.setPosition(new Vec3(x, 0, 1))
    configureTransform(node, width, height)
    const graphics = node.addComponent(Graphics)
    const label = createLabel(node, 'Label', width - 12, height - 6, fontSize, new Color(239, 246, 242))
    label.string = text
    const view = { node, graphics, label }
    this.drawToolButton(view, false, false)
    return view
  }

  private bindPress (node: Node, redraw: (pressed: boolean) => void, activate: () => void): void {
    node.on(Node.EventType.TOUCH_START, () => redraw(true))
    node.on(Node.EventType.TOUCH_CANCEL, () => redraw(false))
    node.on(Node.EventType.TOUCH_END, () => {
      activate()
      redraw(false)
    })
  }

  private renderViews (): void {
    if (!this.root) return
    if (this.roundLabel) this.roundLabel.string = this.state.matchLabel
    if (this.levelLabel) this.levelLabel.string = this.state.levelLabel
    this.renderTimer()
    this.renderCounter()
    this.renderSeats()
    this.renderSuitButtons()
    if (this.lockButton) {
      this.lockButton.label.string = this.state.handLocked ? '确认锁牌' : '锁牌'
      this.drawToolButton(this.lockButton, this.state.handLocked, false)
    }
    if (this.arrangeButton) this.arrangeButton.label.string = this.state.arrangeRestoreAvailable ? '复原' : '一键理牌'
  }

  private renderTimer (): void {
    if (!this.timerGraphics || !this.timerLabel) return
    if (this.timerNode) this.timerNode.active = this.state.turnVisible
    if (!this.state.turnVisible) return
    const duration = Math.max(1, finiteOr(this.state.turnDurationSeconds, 15))
    const remaining = Math.max(0, finiteOr(this.state.turnSeconds, 0))
    const progressRemaining = clamp(remaining, 0, duration)
    const warning = remaining <= 5
    const graphics = this.timerGraphics
    graphics.clear()
    if (!this.timerArtwork) {
      graphics.fillColor = new Color(7, 31, 43, 238)
      graphics.strokeColor = new Color(105, 179, 191, 230)
      graphics.lineWidth = 3
      graphics.circle(0, 0, 37)
      graphics.fill()
      graphics.stroke()
      graphics.strokeColor = warning ? new Color(255, 95, 74, 255) : new Color(255, 206, 74, 255)
      graphics.lineWidth = 6
      graphics.arc(0, 0, 32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (progressRemaining / duration), false)
      graphics.stroke()
    }
    this.timerLabel.string = String(Math.ceil(remaining))
    this.timerLabel.color = warning ? new Color(255, 126, 105) : new Color(255, 255, 255)
  }

  private renderCounter (): void {
    if (!this.counterPanel || !this.counterGraphics || !this.counterTitle || !this.counterToggleLabel || !this.counterHitArea) return
    const expanded = this.state.counterExpanded
    const height = expanded ? BASE_COUNTER_OPEN_HEIGHT : BASE_COUNTER_CLOSED_HEIGHT
    configureTransform(this.counterPanel, BASE_COUNTER_WIDTH, height)
    drawPanel(this.counterGraphics, BASE_COUNTER_WIDTH, height, 8)
    const headerY = 0
    this.counterTitle.node.setPosition(new Vec3(-264, headerY, 1))
    this.counterToggleLabel.node.setPosition(new Vec3(270, headerY, 1))
    this.counterToggleLabel.string = expanded ? '收起' : '展开'
    this.counterHitArea.setPosition(new Vec3(270, headerY, 4))
    if (this.counterDragHandle) {
      this.counterDragHandle.setPosition(new Vec3(-264, headerY, 4))
      configureTransform(this.counterDragHandle, 68, height)
    }
    if (expanded) {
      const tableLeft = -233.75
      const tableRight = 238.25
      this.counterGraphics.strokeColor = new Color(90, 145, 154, 130)
      this.counterGraphics.lineWidth = 1
      this.counterGraphics.moveTo(tableLeft, 0)
      this.counterGraphics.lineTo(tableRight, 0)
      for (let index = 0; index <= TABLE_GAME_HUD_COUNTER_RANKS.length; index += 1) {
        const x = tableLeft + index * 31.5
        this.counterGraphics.moveTo(x, -31)
        this.counterGraphics.lineTo(x, 31)
      }
      this.counterGraphics.stroke()
    }
    this.counterCells.forEach((cell, rank) => {
      cell.rankLabel.node.active = expanded
      cell.countLabel.node.active = expanded
      const raw = this.state.cardCounts[rank]
      const count = raw === undefined ? null : Math.max(0, Math.trunc(finiteOr(raw, 0)))
      cell.rankLabel.string = rank
      cell.countLabel.string = String(count ?? '-')
      const color = count === 0 ? new Color(111, 139, 143) : count !== null && count <= 2 ? new Color(255, 201, 89) : new Color(218, 235, 231)
      cell.rankLabel.color = color
      cell.countLabel.color = color
    })
  }

  private renderSeats (): void {
    const byPlace = new Map(this.state.seats.map(seat => [seat.place, seat]))
    SEAT_PLACES.forEach(place => {
      const seat = byPlace.get(place) ?? { place, name: DEFAULT_SEAT_NAMES[place], status: '剩27张' }
      const view = this.seatViews.get(place)
      if (!view) return
      const offline = Boolean(seat.offline)
      const active = Boolean(seat.active) && !offline
      view.graphics.clear()
      view.graphics.fillColor = offline ? new Color(71, 82, 84) : AVATAR_COLORS[place]
      view.graphics.strokeColor = active ? new Color(255, 218, 104) : new Color(221, 236, 232)
      view.graphics.lineWidth = active ? 2.5 : 1.5
      view.graphics.roundRect(-85, -27, 54, 54, 8)
      view.graphics.fill()
      view.graphics.stroke()
      view.graphics.fillColor = active ? new Color(98, 70, 20, 245) : new Color(31, 60, 68, 245)
      view.graphics.roundRect(-20, -24, 108, 20, 6)
      view.graphics.fill()
      view.avatarSprite.spriteFrame = this.defaultAvatarFrame
      view.avatarSprite.node.active = Boolean(this.defaultAvatarFrame)
      view.avatarSprite.color = offline ? new Color(150, 156, 154) : new Color(255, 255, 255)
      view.nameLabel.string = seat.name || DEFAULT_SEAT_NAMES[place]
      view.nameLabel.color = offline ? new Color(148, 163, 163) : new Color(240, 246, 243)
      view.rankLabel.string = seat.status
    })
  }

  private isSuitAvailable (suit: TableGameHudSuit): boolean {
    return this.state.availableSuits.includes(suit)
  }

  private renderSuitButtons (): void {
    if (!this.suitBarGraphics) return
    const graphics = this.suitBarGraphics
    graphics.clear()
    graphics.fillColor = new Color(8, 33, 43, 232)
    graphics.strokeColor = new Color(93, 173, 187, 230)
    graphics.lineWidth = 1.75
    graphics.roundRect(-82, -23, 244, 46, 12)
    graphics.fill()
    graphics.stroke()

    SUITS.forEach((suit, index) => {
      const view = this.suitButtons.get(suit)
      if (!view) return
      const available = this.isSuitAvailable(suit)
      const selected = available && this.state.selectedSuit === suit
      const pressed = available && this.pressedSuit === suit
      const redSuit = suit === 'heart' || suit === 'diamond'
      const x = -48 + index * 58

      if (available) {
        const accent = selected
          ? new Color(255, 218, 80, 255)
          : redSuit
            ? new Color(255, 104, 102, 245)
            : new Color(94, 231, 214, 245)
        graphics.strokeColor = accent
        graphics.lineWidth = selected ? 4 : 2.5
        graphics.moveTo(x - (selected ? 18 : 14), -17)
        graphics.lineTo(x + (selected ? 18 : 14), -17)
        graphics.stroke()
        if (selected) {
          graphics.fillColor = new Color(accent.r, accent.g, accent.b, pressed ? 72 : 48)
          graphics.circle(x, 1, pressed ? 17 : 19)
          graphics.fill()
        }
      }

      view.label.color = !available
        ? new Color(91, 112, 114, 170)
        : selected
          ? new Color(255, 232, 122, 255)
          : redSuit
            ? new Color(255, 116, 112, 255)
            : new Color(184, 255, 244, 255)
      const scale = selected ? (pressed ? 1.04 : 1.12) : pressed ? 0.94 : available ? 1 : 0.9
      view.label.node.setScale(new Vec3(scale, scale, 1))
    })
  }

  private drawToolButton (view: ButtonView | null, active: boolean, pressed: boolean): void {
    if (!view) return
    const transform = view.node.getComponent(UITransform)
    this.drawButtonSurface(view.graphics, transform?.contentSize.width ?? 96, transform?.contentSize.height ?? 42, active, pressed)
  }

  private drawButtonSurface (graphics: Graphics, width: number, height: number, active: boolean, pressed: boolean): void {
    graphics.clear()
    graphics.fillColor = pressed
      ? new Color(24, 82, 85, 250)
      : active
        ? new Color(159, 112, 25, 246)
        : new Color(17, 57, 69, 240)
    graphics.strokeColor = active ? new Color(255, 220, 104, 255) : new Color(101, 180, 192, 230)
    graphics.lineWidth = active ? 2.5 : 1.5
    graphics.roundRect(-width / 2, -height / 2, width, height, 7)
    graphics.fill()
    graphics.stroke()
  }
}
