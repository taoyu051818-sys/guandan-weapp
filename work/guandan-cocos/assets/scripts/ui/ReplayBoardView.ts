import { drawUiFrame } from './UiFrameStyle'
import { Color, Graphics, Label, Node, UITransform, Vec3 } from 'cc'
import type { ReplaySeatAction, ReplaySeatId, ReplayTimelineState } from '../replay/ReplayTimeline'
import { applyForegroundTextStyle, RUNTIME_MIN_TEXT_SIZE, RuntimeUiFactory } from './RuntimeUiFactory'
import { CardView } from './CardView'
import type { CardPresentation } from './CardView'
import type { ClassicCardSuit } from './CardSkinResolver'
import { projectReplaySeats, replayWinnerLabel, type ReplaySeatPlacement, type ReplayViewpoint } from './ReplayViewpoint'

const PLAY_TYPE_LABELS: Readonly<Record<string, string>> = {
  Single: '单牌',
  Pair: '对子',
  Triple: '三张',
  Straight: '顺子',
  TripleWithPair: '三带二',
  Tube: '三连对',
  Plate: '钢板',
  StraightFlush: '同花顺',
  Bomb: '炸弹',
  Rocket: '四王炸',
}

const PHASE_LABELS: Readonly<Record<ReplayTimelineState['phase'], string>> = {
  idle: '等待公开动作',
  'game-start': '本场开始',
  'round-start': '新一局开始',
  tribute: '贡还阶段',
  'anti-tribute': '抗贡',
  playing: '出牌阶段',
  'round-ended': '本局结算',
  'room-closed': '牌桌已终止',
}

const replayCardPresentation = (
  card: Readonly<{ rank: string, suit: string }>,
  index: number,
): CardPresentation => {
  const suit: ClassicCardSuit = card.suit === 'spade' || card.suit === 'heart' || card.suit === 'club' || card.suit === 'diamond'
    ? card.suit
    : 'joker'
  return {
    id: `replay-${index}-${card.rank}-${suit}`,
    rank: card.rank,
    suit,
    red: suit === 'heart' || suit === 'diamond' || (suit === 'joker' && card.rank === 'Big'),
    levelCard: false,
    selected: false,
    interactive: false,
  }
}

const actionLabel = (action: ReplaySeatAction | null): string => {
  if (!action) return '等待动作'
  if (action.type === 'tribute') return '已进贡'
  if (action.type === 'return-tribute') return '已还贡'
  if (action.type === 'pass') return action.automatic ? '自动不要' : '不要'
  const playType = PLAY_TYPE_LABELS[action.playType ?? ''] ?? action.playType ?? '出牌'
  return `${playType} · ${action.cards.length}张${action.automatic ? ' · 自动' : ''}`
}

const createPanel = (parent: Node, name: string, x: number, y: number, width: number, height: number, active = false): Node => {
  const node = new Node(name)
  node.parent = parent
  node.setPosition(new Vec3(x, y, 0))
  node.addComponent(UITransform).setContentSize(width, height)
  const graphics = node.addComponent(Graphics)
  graphics.fillColor = active ? new Color(72, 59, 25, 242) : new Color(15, 42, 41, 232)
  graphics.strokeColor = active ? new Color(246, 204, 91, 255) : new Color(133, 176, 148, 210)
  graphics.lineWidth = active ? 3 : 2
  drawUiFrame(graphics, -width / 2, -height / 2, width, height)
  graphics.fill()
  graphics.stroke()
  return node
}

const createText = (parent: Node, text: string, fontSize: number, color: Color, width: number, height: number): Label => {
  const resolvedFontSize = Math.max(RUNTIME_MIN_TEXT_SIZE, Math.round(fontSize))
  const node = new Node('ReplayText')
  node.parent = parent
  node.addComponent(UITransform).setContentSize(width, height)
  const label = node.addComponent(Label)
  label.string = text
  label.fontSize = resolvedFontSize
  label.lineHeight = resolvedFontSize + 5
  label.overflow = Label.Overflow.SHRINK
  label.enableWrapText = true
  label.horizontalAlign = Label.HorizontalAlign.CENTER
  label.verticalAlign = Label.VerticalAlign.CENTER
  label.color = color
  const outline = color.r + color.g + color.b < 330
    ? new Color(255, 249, 230, 255)
    : new Color(20, 38, 35, 255)
  return applyForegroundTextStyle(label, outline, 2)
}

const renderSeat = (
  parent: Node,
  seat: ReplaySeatId,
  action: ReplaySeatAction | null,
  participants: Readonly<Record<string, string>>,
  active: boolean,
  position: ReplaySeatPlacement,
): void => {
  const node = createPanel(parent, `ReplaySeat-${seat}`, position.x, position.y, 178, 58, active)
  const displayName = participants[seat]?.trim() || seat.toUpperCase()
  const label = createText(
    node,
    `${position.side} · ${displayName}\n${actionLabel(action)}`,
    15,
    active ? new Color(255, 226, 133) : new Color(226, 239, 225),
    164,
    52,
  )
  label.node.setPosition(Vec3.ZERO)
}

const renderCards = (parent: Node, state: ReplayTimelineState): void => {
  const cards = state.tableCards
  if (!cards.length) {
    const empty = createText(parent, '桌面暂无公开牌', 18, new Color(170, 195, 183), 300, 34)
    empty.node.setPosition(new Vec3(0, 2, 1))
    return
  }
  const maximumPerRow = 14
  const rowCount = Math.ceil(cards.length / maximumPerRow)
  cards.forEach((card, index) => {
    const row = Math.floor(index / maximumPerRow)
    const rowStart = row * maximumPerRow
    const cardsInRow = Math.min(maximumPerRow, cards.length - rowStart)
    const column = index - rowStart
    const x = (column - (cardsInRow - 1) / 2) * 41
    const y = rowCount === 1 ? -2 : 29 - row * 62
    const cardNode = new Node(`ReplayCard-${index}`)
    cardNode.parent = parent
    cardNode.setPosition(new Vec3(x, y, index + 1))
    const cardView = cardNode.addComponent(CardView)
    cardView.bind(replayCardPresentation(card, index))
    cardNode.setScale(new Vec3(0.48, 0.48, 1))
  })
}

const resultText = (state: ReplayTimelineState, viewpoint: ReplayViewpoint): string => {
  if (state.phase === 'round-ended') {
    const rank = state.ranking.length ? ` · ${state.ranking.join(' > ')}` : ''
    const winner = state.winnerTeam ? ` · ${replayWinnerLabel(state.winnerTeam, viewpoint)}` : ''
    return `本局结算${winner}${rank}`
  }
  if (state.phase === 'room-closed') return `牌桌终止 · ${state.closedReason ?? '未说明原因'}`
  const player = state.tablePlayerId ? ` · ${state.tablePlayerId.toUpperCase()} 最近出牌` : ''
  const playType = state.tablePlayType ? ` · ${PLAY_TYPE_LABELS[state.tablePlayType] ?? state.tablePlayType}` : ''
  return `${PHASE_LABELS[state.phase]}${player}${playType}`
}

/** Draws only the public replay state. No hand count or hidden card is inferred. */
export const renderReplayBoard = (
  ui: RuntimeUiFactory,
  state: ReplayTimelineState,
  participants: Readonly<Record<string, string>> = {},
  viewpoint: ReplayViewpoint,
): void => {
  const board = createPanel(ui.parent, 'ReplayBoard', 0, 10, 790, 330)
  const surface = board.getComponent(Graphics)
  if (surface) {
    surface.fillColor = new Color(19, 75, 62, 235)
    surface.strokeColor = new Color(218, 179, 79, 230)
    surface.lineWidth = 3
    drawUiFrame(surface, -395, -165, 790, 330)
    surface.fill()
    surface.stroke()
    surface.strokeColor = new Color(130, 197, 158, 80)
    surface.lineWidth = 2
    surface.ellipse(0, 0, 250, 100)
    surface.stroke()
  }
  projectReplaySeats(viewpoint).forEach(position => renderSeat(board, position.seat, state.seatActions[position.seat], participants, state.tablePlayerId === position.seat, position))
  renderCards(board, state)
  const phase = createText(board, resultText(state, viewpoint), 16, new Color(255, 224, 132), 560, 34)
  phase.node.setPosition(new Vec3(0, 78, 20))
}
