import { TABLE_BUTTON_HEIGHT } from './TableButtonMetrics'
import { drawUiFrame } from './UiFrameStyle'
import { Color, Graphics, Label, Node, UITransform, Vec2, Vec3 } from 'cc'
import type { PlayerId } from '../core/generated'
import type { HandLockDecision } from '../game/HandWorkspace'
import { applyForegroundTextStyle } from './RuntimeUiFactory'
import { createDefaultTableHudSeats, type TableHudSeatState } from './TableHudSeatViewGroup'
import type { TableHudSeatPlace, TableHudViewport } from './TableHudLayoutPolicy'

export const TABLE_GAME_HUD_CARD_COUNTER_STATUS = 'active' as const
export const TABLE_GAME_HUD_COUNTER_RANKS = ['大王', '小王', '2', 'A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3'] as const

export type TableGameHudCounterRank = typeof TABLE_GAME_HUD_COUNTER_RANKS[number]
export type TableGameHudSeatPlace = TableHudSeatPlace
export type TableGameHudSuit = 'spade' | 'heart' | 'club' | 'diamond'
export type TableGameHudViewport = TableHudViewport
export type TableGameHudSeatState = TableHudSeatState

export type TableGameHudState = Readonly<{
  matchLabel: string
  levelLabel: string
  turnVisible: boolean
  turnSeconds: number
  turnDurationSeconds: number
  turnPlace: TableGameHudSeatPlace
  counterExpanded: boolean
  counterEnabled?: boolean
  counterPossibleSuits?: readonly TableGameHudSuit[]
  cardCounts: Readonly<Partial<Record<TableGameHudCounterRank, number>>>
  seats: readonly TableGameHudSeatState[]
  availableSuits: readonly TableGameHudSuit[]
  selectedSuit: TableGameHudSuit | null
  lockDecision: HandLockDecision
  arrangeRestoreAvailable: boolean
  handViewLabel?: string
  handToolsVisible?: boolean
  arrangeVisible?: boolean
  tributeInfo?: string
  trusteeVisible?: boolean
  trusteeActive?: boolean
}>

export type TableGameHudActions = Readonly<{
  onBack?: () => void
  onCounterVisibilityChange?: (expanded: boolean) => void
  onSuitSelect?: (suit: TableGameHudSuit | null) => void
  onHandLockAction?: () => void
  onArrange?: () => void
  onTrustee?: () => void
  onOwnAvatar?: () => void
  onSeatAvatar?: (playerId: PlayerId) => void
}>

export type ButtonView = {
  node: Node
  graphics: Graphics
  label: Label
}

export type CounterCell = {
  rankLabel: Label
  countLabel: Label
}

export type SuitButtonView = {
  node: Node
  sprite: import('cc').Sprite
}

export const BASE_COUNTER_WIDTH = 596
export const BASE_COUNTER_OPEN_HEIGHT = 82
export const BASE_COUNTER_CLOSED_HEIGHT = TABLE_BUTTON_HEIGHT
export const BASE_TOOLBAR_WIDTH = 420
export const EXPANDED_ROUND_WIDTH = 240
export const EXPANDED_ROUND_HEIGHT = 84
export const EXPANDED_SUIT_BAR_WIDTH = 480
export const EXPANDED_SUIT_BAR_HEIGHT = TABLE_BUTTON_HEIGHT
export const EXPANDED_TOOLBAR_WIDTH = 480
export const EXPANDED_TOOLBAR_HEIGHT = 70
export const SUITS: readonly TableGameHudSuit[] = ['spade', 'heart', 'club', 'diamond']
export type DraggableOverlay = 'counter' | 'operations'

const MIN_HUD_FONT_SIZE = 20

export const freshTableGameHudState = (): TableGameHudState => ({
  matchLabel: '本局打 2',
  levelLabel: '我方 2级 · 对方 2级',
  turnVisible: true,
  turnSeconds: 15,
  turnDurationSeconds: 15,
  turnPlace: 'bottom',
  counterExpanded: false,
  cardCounts: {},
  counterPossibleSuits: [],
  seats: createDefaultTableHudSeats(),
  availableSuits: [],
  selectedSuit: null,
  lockDecision: { kind: 'unavailable', reason: 'empty-selection' },
  arrangeRestoreAvailable: false,
})

export const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))

export const finiteOr = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? Number(value) : fallback

export const normalizeAvailableSuits = (suits: readonly TableGameHudSuit[] | undefined): readonly TableGameHudSuit[] => {
  const requested = new Set(suits ?? [])
  return SUITS.filter(suit => requested.has(suit))
}

export const configureTransform = (node: Node, width: number, height: number): UITransform => {
  const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform)
  transform.setContentSize(width, height)
  return transform
}

export const nodeContentSize = (
  node: Node | null | undefined,
  fallbackWidth: number,
  fallbackHeight: number,
): Readonly<{ width: number, height: number }> => {
  const contentSize = node?.getComponent(UITransform)?.contentSize
  return {
    width: Math.max(1, contentSize?.width ?? fallbackWidth),
    height: Math.max(1, contentSize?.height ?? fallbackHeight),
  }
}

export const configureLabelMetrics = (
  label: Label | null,
  width: number,
  height: number,
  fontSize: number,
  x: number,
  y: number,
): void => {
  if (!label) return
  configureTransform(label.node, width, height)
  label.node.setPosition(new Vec3(x, y, 1))
  label.fontSize = Math.max(MIN_HUD_FONT_SIZE, Math.round(fontSize))
  label.lineHeight = label.fontSize + 6
  applyForegroundTextStyle(label, new Color(18, 38, 43, 255), label.fontSize >= 30 ? 4 : 3)
}

export const createTableHudLabel = (
  parent: Node,
  name: string,
  width: number,
  height: number,
  fontSize: number,
  color: Color,
  x = 0,
  y = 0,
): Label => {
  const resolvedFontSize = Math.max(MIN_HUD_FONT_SIZE, Math.round(fontSize))
  const node = new Node(name)
  node.parent = parent
  node.setPosition(new Vec3(x, y, 1))
  configureTransform(node, width, height)
  const label = node.addComponent(Label)
  label.fontSize = resolvedFontSize
  label.lineHeight = resolvedFontSize + 5
  label.overflow = Label.Overflow.SHRINK
  label.horizontalAlign = Label.HorizontalAlign.CENTER
  label.verticalAlign = Label.VerticalAlign.CENTER
  label.color = color
  label.string = ''
  return applyForegroundTextStyle(label, new Color(18, 38, 43, 255), resolvedFontSize >= 24 ? 3 : 2)
}

export const drawTableHudPanel = (graphics: Graphics, width: number, height: number, active = false): void => {
  graphics.clear()
  graphics.fillColor = active ? new Color(25, 68, 78, 242) : new Color(10, 34, 48, 225)
  graphics.strokeColor = active ? new Color(245, 198, 77, 255) : new Color(101, 179, 194, 215)
  graphics.lineWidth = active ? 2.5 : 1.5
  drawUiFrame(graphics, -width / 2, -height / 2, width, height)
  graphics.fill()
  graphics.stroke()
}

export const drawTableHudButton = (view: ButtonView | null, active: boolean, pressed: boolean): void => {
  if (!view) return
  const transform = view.node.getComponent(UITransform)
  const width = transform?.contentSize.width ?? 96
  const height = transform?.contentSize.height ?? 42
  view.graphics.clear()
  view.graphics.fillColor = pressed
    ? new Color(24, 82, 85, 250)
    : active
      ? new Color(159, 112, 25, 246)
      : new Color(17, 57, 69, 240)
  view.graphics.strokeColor = active ? new Color(255, 220, 104, 255) : new Color(101, 180, 192, 230)
  view.graphics.lineWidth = active ? 2.5 : 1.5
  drawUiFrame(view.graphics, -width / 2, -height / 2, width, height, 'control')
  view.graphics.fill()
  view.graphics.stroke()
}

export const createTableHudButton = (
  parent: Node,
  name: string,
  text: string,
  x: number,
  width: number,
  height: number,
  fontSize: number,
): ButtonView => {
  const node = new Node(name)
  node.parent = parent
  node.setPosition(new Vec3(x, 0, 1))
  configureTransform(node, width, height)
  const graphics = node.addComponent(Graphics)
  const label = createTableHudLabel(node, 'Label', width - 12, height - 6, fontSize, new Color(239, 246, 242))
  label.string = text
  const view = { node, graphics, label }
  drawTableHudButton(view, false, false)
  return view
}

export const bindTableHudPress = (node: Node, redraw: (pressed: boolean) => void, activate: () => void): void => {
  node.on(Node.EventType.TOUCH_START, () => redraw(true))
  node.on(Node.EventType.TOUCH_CANCEL, () => redraw(false))
  node.on(Node.EventType.TOUCH_END, () => {
    activate()
    redraw(false)
  })
}

export const hitTestVisibleNodes = (
  nodes: readonly (Node | null | undefined)[],
  screenPoint: Readonly<{ x: number, y: number }>,
): boolean => {
  const point = new Vec2(screenPoint.x, screenPoint.y)
  return nodes.some(node => Boolean(node?.isValid && node.activeInHierarchy && node.getComponent(UITransform)?.hitTest(point)))
}
