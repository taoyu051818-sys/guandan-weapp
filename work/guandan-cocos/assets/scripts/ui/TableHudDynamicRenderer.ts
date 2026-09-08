import { Color, type Graphics, type Label, type Node, type Sprite, Vec3 } from 'cc'
import { renderSuitAvailability } from './TableHudSuitAvailability'
import {
  BASE_COUNTER_CLOSED_HEIGHT,
  BASE_COUNTER_OPEN_HEIGHT,
  BASE_COUNTER_WIDTH,
  SUITS,
  TABLE_GAME_HUD_COUNTER_RANKS,
  configureTransform,
  drawTableHudPanel,
  finiteOr,
  nodeContentSize,
  type CounterCell,
  type SuitButtonView,
  type TableGameHudCounterRank,
  type TableGameHudState,
  type TableGameHudSuit,
} from './TableGameHudFoundation'


export type TableHudCounterRenderInput = Readonly<{
  panel: Node | null
  graphics: Graphics | null
  title: Label | null
  toggleLabel: Label | null
  hitArea: Node | null
  dragHandle: Node | null
  cells: ReadonlyMap<TableGameHudCounterRank, CounterCell>
  suitSprites: ReadonlyMap<TableGameHudSuit, Sprite>
  state: TableGameHudState
}>

/** Draws the changing card-counter surface without owning HUD lifecycle or input. */
export const renderTableHudCounter = (input: TableHudCounterRenderInput): void => {
  const { panel, graphics, title, toggleLabel, hitArea, dragHandle, state } = input
  if (!panel || !graphics || !title || !toggleLabel || !hitArea) return
  panel.active = state.counterEnabled !== false
  if (!panel.active) return
  const expanded = state.counterExpanded
  const height = expanded ? BASE_COUNTER_OPEN_HEIGHT : BASE_COUNTER_CLOSED_HEIGHT
  configureTransform(panel, BASE_COUNTER_WIDTH, height)
  drawTableHudPanel(graphics, BASE_COUNTER_WIDTH, height, 8)
  title.node.setPosition(new Vec3(-264, expanded ? 18 : 0, 1))
  toggleLabel.node.setPosition(new Vec3(270, 0, 1))
  toggleLabel.string = expanded ? '收起' : '展开'
  hitArea.setPosition(new Vec3(270, 0, 4))
  if (dragHandle) {
    dragHandle.setPosition(new Vec3(-264, 0, 4))
    configureTransform(dragHandle, 68, height)
  }

  input.suitSprites.forEach((sprite, suit) => {
    const possible = state.counterPossibleSuits?.includes(suit) ?? false
    sprite.node.active = expanded && Boolean(sprite.spriteFrame)
    renderSuitAvailability(sprite, suit, possible)
  })
  if (expanded) {
    const tableLeft = -233.75
    const tableRight = 238.25
    graphics.strokeColor = new Color(90, 145, 154, 130)
    graphics.lineWidth = 1
    graphics.moveTo(tableLeft, 0)
    graphics.lineTo(tableRight, 0)
    for (let index = 0; index <= TABLE_GAME_HUD_COUNTER_RANKS.length; index += 1) {
      const x = tableLeft + index * 31.5
      graphics.moveTo(x, -35)
      graphics.lineTo(x, 35)
    }
    graphics.stroke()
  }

  input.cells.forEach((cell, rank) => {
    cell.rankLabel.node.active = expanded
    cell.countLabel.node.active = expanded
    const raw = state.cardCounts[rank]
    const count = raw === undefined ? null : Math.max(0, Math.trunc(finiteOr(raw, 0)))
    cell.rankLabel.string = rank
    cell.countLabel.string = String(count ?? '-')
    const color = count === 0
      ? new Color(111, 139, 143)
      : count !== null && count <= 2
        ? new Color(255, 201, 89)
        : new Color(218, 235, 231)
    cell.rankLabel.color = color
    cell.countLabel.color = color
  })
}

export type TableHudSuitRenderInput = Readonly<{
  bar: Node | null
  graphics: Graphics | null
  buttons: ReadonlyMap<TableGameHudSuit, SuitButtonView>
  availableSuits: readonly TableGameHudSuit[]
  selectedSuit: TableGameHudSuit | null
  pressedSuit: TableGameHudSuit | null
}>

/** Draws one shared suit lane; individual suit nodes remain frameless hit targets. */
export const renderTableHudSuits = (input: TableHudSuitRenderInput): void => {
  if (input.bar) input.bar.active = true
  const { graphics } = input
  if (!graphics) return
  const barSize = nodeContentSize(input.bar, 382, 54)
  const expandedMetrics = barSize.width > 382
  graphics.clear()
  graphics.fillColor = new Color(8, 33, 43, 232)
  graphics.strokeColor = new Color(93, 173, 187, 230)
  graphics.lineWidth = 1.75
  if (expandedMetrics) graphics.roundRect(-116, -29, 326, 58, 18)
  else graphics.roundRect(-82, -23, 244, 46, 12)
  graphics.fill()
  graphics.stroke()

  SUITS.forEach((suit, index) => {
    const view = input.buttons.get(suit)
    if (!view) return
    const available = input.availableSuits.includes(suit)
    const selected = available && input.selectedSuit === suit
    const pressed = available && input.pressedSuit === suit
    const redSuit = suit === 'heart' || suit === 'diamond'
    const x = expandedMetrics ? -66 + index * 70 : -48 + index * 58
    if (available) {
      const accent = selected ? new Color(255, 218, 80, 255) : redSuit ? new Color(255, 104, 102, 245) : new Color(94, 231, 214, 245)
      graphics.strokeColor = accent
      graphics.lineWidth = selected ? 5 : 3.5
      const underlineHalfWidth = expandedMetrics ? (selected ? 22 : 18) : (selected ? 18 : 14)
      const underlineY = expandedMetrics ? -22 : -17
      graphics.moveTo(x - underlineHalfWidth, underlineY)
      graphics.lineTo(x + underlineHalfWidth, underlineY)
      graphics.stroke()
      if (selected) {
        graphics.fillColor = new Color(accent.r, accent.g, accent.b, pressed ? 72 : 48)
        graphics.circle(x, 1, pressed ? (expandedMetrics ? 20 : 17) : (expandedMetrics ? 22 : 19))
        graphics.fill()
      }
    }
    renderSuitAvailability(view.sprite, suit, available)
    const scale = selected ? (pressed ? 1.04 : 1.12) : pressed ? 0.94 : available ? 1 : 0.9
    view.sprite.node.setScale(new Vec3(scale, scale, 1))
  })
}
