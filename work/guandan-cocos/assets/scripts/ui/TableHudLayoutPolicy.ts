import { resolveSafePriorityRects } from './SafeAreaLayout'

export type TableHudSeatPlace = 'bottom' | 'right' | 'top' | 'left'

export type TableHudViewport = Readonly<{
  width: number
  height: number
  safeLeft?: number
  safeRight?: number
  safeTop?: number
  safeBottom?: number
}>

export type TableHudSize = Readonly<{ width: number, height: number }>
export type TableHudPoint = Readonly<{ x: number, y: number }>

export type TableHudBounds = Readonly<{
  scale: number
  left: number
  right: number
  top: number
  bottom: number
}>

export type TableHudPlacement = Readonly<{
  x: number
  y: number
  scale: number
  visible: boolean
}>

export type TableHudFrameLayout = Readonly<{
  bounds: TableHudBounds
  top: Readonly<{
    back: TableHudPlacement
    round: TableHudPlacement
  }>
  seats: Readonly<Record<TableHudSeatPlace, TableHudPlacement>>
  bottom: Readonly<{
    suitBar: TableHudPlacement
    toolbar: TableHudPlacement
  }>
}>

export type TableHudOperationRowLayout = Readonly<{
  size: TableHudSize
  timerX: number
  actionXs: readonly number[]
}>

export const TABLE_GAME_HUD_DESIGN_SIZE = Object.freeze({ width: 1280, height: 720 })
export const TABLE_HUD_MIN_SCALE = 0.78
export const TABLE_HUD_BOTTOM_GROUP_GAP = 8
export const TABLE_HUD_SEAT_PLACES: readonly TableHudSeatPlace[] = ['bottom', 'right', 'top', 'left']
export const TABLE_HUD_TURN_OPERATION_ANCHORS: Readonly<Record<TableHudSeatPlace, TableHudPoint>> = Object.freeze({
  bottom: Object.freeze({ x: 0, y: -82 }),
  right: Object.freeze({ x: 300, y: 0 }),
  top: Object.freeze({ x: 0, y: 218 }),
  left: Object.freeze({ x: -300, y: 0 }),
})

const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value))
const finiteOr = (value: number | undefined, fallback: number): number => Number.isFinite(value) ? Number(value) : fallback

export const normalizeTableHudViewport = (viewport: TableHudViewport): TableHudViewport => ({
  width: Math.max(1, finiteOr(viewport.width, TABLE_GAME_HUD_DESIGN_SIZE.width)),
  height: Math.max(1, finiteOr(viewport.height, TABLE_GAME_HUD_DESIGN_SIZE.height)),
  safeLeft: Math.max(0, finiteOr(viewport.safeLeft, 0)),
  safeRight: Math.max(0, finiteOr(viewport.safeRight, 0)),
  safeTop: Math.max(0, finiteOr(viewport.safeTop, 0)),
  safeBottom: Math.max(0, finiteOr(viewport.safeBottom, 0)),
})

export const resolveTableHudBounds = (viewport: TableHudViewport): TableHudBounds => {
  const safeLeft = viewport.safeLeft ?? 0
  const safeRight = viewport.safeRight ?? 0
  const safeTop = viewport.safeTop ?? 0
  const safeBottom = viewport.safeBottom ?? 0
  const safeWidth = Math.max(1, viewport.width - safeLeft - safeRight)
  const safeHeight = Math.max(1, viewport.height - safeTop - safeBottom)
  const fit = Math.min(safeWidth / TABLE_GAME_HUD_DESIGN_SIZE.width, safeHeight / TABLE_GAME_HUD_DESIGN_SIZE.height)
  return {
    scale: clamp(fit, TABLE_HUD_MIN_SCALE, 1.4),
    left: -viewport.width / 2 + safeLeft,
    right: viewport.width / 2 - safeRight,
    top: viewport.height / 2 - safeTop,
    bottom: -viewport.height / 2 + safeBottom,
  }
}

const resolveTopLayout = (
  bounds: TableHudBounds,
  backSize: TableHudSize,
  roundSize: TableHudSize,
): TableHudFrameLayout['top'] => {
  const safePixelWidth = Math.max(1, bounds.right - bounds.left - 16)
  const topGap = 12
  const canShowRound = (backSize.width + roundSize.width + topGap * 2) * bounds.scale <= safePixelWidth
  const backX = bounds.left + 8 + backSize.width * bounds.scale / 2
  const roundX = backX + (backSize.width + roundSize.width) * bounds.scale / 2 + topGap * bounds.scale
  const placements = resolveSafePriorityRects({ left: bounds.left + 8, right: bounds.right - 8, top: bounds.top - 6, bottom: bounds.bottom + 8 }, [
    { id: 'back', x: backX, y: bounds.top - 6 - backSize.height * bounds.scale / 2, width: backSize.width * bounds.scale, height: backSize.height * bounds.scale, priority: 90, canHide: false },
    { id: 'round', x: roundX, y: bounds.top - 6 - roundSize.height * bounds.scale / 2, width: roundSize.width * bounds.scale, height: roundSize.height * bounds.scale, priority: 60, shiftAxis: 'x', shiftStep: 20 * bounds.scale, maxShift: 100 * bounds.scale, canHide: true },
  ], 4)
  const back = placements[0]
  const round = placements[1]
  return {
    back: { x: back.x, y: back.y, scale: bounds.scale, visible: back.visible },
    round: { x: round.x, y: round.y, scale: bounds.scale, visible: canShowRound && round.visible },
  }
}

const resolveSeatLayout = (bounds: TableHudBounds, seatSize: TableHudSize): TableHudFrameLayout['seats'] => {
  const sideSeatX = seatSize.width * bounds.scale / 2 + 12
  const bottomSeatY = bounds.bottom + seatSize.height * bounds.scale / 2 + 38 * bounds.scale
  const topSeatX = -seatSize.width * bounds.scale / 2 - 70 * bounds.scale
  const topSeatPlacement = seatSize.width <= 210
    ? { id: 'seat-top', x: -220, y: TABLE_HUD_TURN_OPERATION_ANCHORS.top.y, width: 210 * bounds.scale, height: 76 * bounds.scale, priority: 80, shiftAxis: 'x' as const, shiftStep: 16 * bounds.scale, maxShift: 160 * bounds.scale, canHide: false }
    : { id: 'seat-top', x: topSeatX, y: TABLE_HUD_TURN_OPERATION_ANCHORS.top.y, width: seatSize.width * bounds.scale, height: seatSize.height * bounds.scale, priority: 80, shiftAxis: 'x' as const, shiftStep: 16 * bounds.scale, maxShift: 160 * bounds.scale, canHide: false }
  const placements = resolveSafePriorityRects({ left: bounds.left + 8, right: bounds.right - 8, top: bounds.top - 8, bottom: bounds.bottom + 8 }, [
    topSeatPlacement,
    { id: 'seat-bottom', x: bounds.left + sideSeatX, y: bottomSeatY, width: seatSize.width * bounds.scale, height: seatSize.height * bounds.scale, priority: 75, shiftAxis: 'x' as const, shiftStep: 16 * bounds.scale, maxShift: 160 * bounds.scale, canHide: false },
    { id: 'seat-right', x: bounds.right - sideSeatX, y: 16, width: seatSize.width * bounds.scale, height: seatSize.height * bounds.scale, priority: 70, shiftAxis: 'y' as const, shiftStep: 18 * bounds.scale, maxShift: 216 * bounds.scale, canHide: false },
    { id: 'seat-left', x: bounds.left + sideSeatX, y: 16, width: seatSize.width * bounds.scale, height: seatSize.height * bounds.scale, priority: 70, shiftAxis: 'y' as const, shiftStep: 18 * bounds.scale, maxShift: 216 * bounds.scale, canHide: false },
  ], 4)
  const byId = new Map(placements.map(placement => [placement.id, placement]))
  const place = (id: string, fallback: TableHudPoint): TableHudPlacement => {
    const placement = byId.get(id)
    return {
      x: placement?.x ?? fallback.x,
      y: placement?.y ?? fallback.y,
      scale: bounds.scale,
      visible: placement?.visible ?? true,
    }
  }
  return {
    bottom: place('seat-bottom', { x: bounds.left + sideSeatX, y: bottomSeatY }),
    right: place('seat-right', { x: bounds.right - sideSeatX, y: 16 }),
    top: place('seat-top', { x: topSeatX, y: TABLE_HUD_TURN_OPERATION_ANCHORS.top.y }),
    left: place('seat-left', { x: bounds.left + sideSeatX, y: 16 }),
  }
}

const resolveBottomLayout = (
  bounds: TableHudBounds,
  seatSize: TableHudSize,
  suitSize: TableHudSize,
  toolbarSize: TableHudSize,
): TableHudFrameLayout['bottom'] => {
  const laneLeft = bounds.left + 8 + seatSize.width * bounds.scale + TABLE_HUD_BOTTOM_GROUP_GAP
  const laneRight = bounds.right - 8
  const laneWidth = Math.max(1, laneRight - laneLeft)
  const singleRowScale = Math.min(
    bounds.scale,
    laneWidth / (suitSize.width + toolbarSize.width + TABLE_HUD_BOTTOM_GROUP_GAP),
  )
  const splitRows = singleRowScale < bounds.scale * 0.82

  if (!splitRows) {
    const rowHeight = Math.max(suitSize.height, toolbarSize.height) * singleRowScale
    const y = bounds.bottom + 8 + rowHeight / 2
    const toolbarX = laneRight - toolbarSize.width * singleRowScale / 2
    const suitX = toolbarX - toolbarSize.width * singleRowScale / 2 - TABLE_HUD_BOTTOM_GROUP_GAP * singleRowScale - suitSize.width * singleRowScale / 2
    return {
      suitBar: { x: suitX, y, scale: singleRowScale, visible: true },
      toolbar: { x: toolbarX, y, scale: singleRowScale, visible: true },
    }
  }

  const splitScale = Math.min(bounds.scale, laneWidth / Math.max(suitSize.width, toolbarSize.width))
  const toolbarY = bounds.bottom + 8 + toolbarSize.height * splitScale / 2
  const suitY = toolbarY + toolbarSize.height * splitScale / 2 + TABLE_HUD_BOTTOM_GROUP_GAP + suitSize.height * splitScale / 2
  const laneCenter = (laneLeft + laneRight) / 2
  return {
    suitBar: { x: laneCenter, y: suitY, scale: splitScale, visible: true },
    toolbar: { x: laneCenter, y: toolbarY, scale: splitScale, visible: true },
  }
}

export const resolveTableHudFrameLayout = (input: Readonly<{
  viewport: TableHudViewport
  backSize: TableHudSize
  roundSize: TableHudSize
  seatSize: TableHudSize
  suitSize: TableHudSize
  toolbarSize: TableHudSize
}>): TableHudFrameLayout => {
  const viewport = normalizeTableHudViewport(input.viewport)
  const bounds = resolveTableHudBounds(viewport)
  return {
    bounds,
    top: resolveTopLayout(bounds, input.backSize, input.roundSize),
    seats: resolveSeatLayout(bounds, input.seatSize),
    bottom: resolveBottomLayout(bounds, input.seatSize, input.suitSize, input.toolbarSize),
  }
}

export const clampTableHudOverlayPosition = (
  position: TableHudPoint,
  size: TableHudSize,
  bounds: TableHudBounds,
): TableHudPoint => {
  const halfWidth = size.width * bounds.scale / 2
  const halfHeight = size.height * bounds.scale / 2
  const left = bounds.left + 8 + halfWidth
  const right = bounds.right - 8 - halfWidth
  const bottom = bounds.bottom + 8 + halfHeight
  const top = bounds.top - 8 - halfHeight
  return {
    x: left <= right ? clamp(position.x, left, right) : (bounds.left + bounds.right) / 2,
    y: bottom <= top ? clamp(position.y, bottom, top) : (bounds.bottom + bounds.top) / 2,
  }
}

export const resolveTableHudOperationRow = (actionWidths: readonly number[]): TableHudOperationRowLayout => {
  const timerWidth = 112
  const height = 112
  const gap = 10
  const widths = actionWidths.map(width => Math.max(72, finiteOr(width, 112)))
  const width = timerWidth + widths.reduce((sum, value) => sum + value, 0) + gap * widths.length
  let cursor = -width / 2
  const timerX = cursor + timerWidth / 2
  cursor += timerWidth + gap
  const actionXs = widths.map((actionWidth, index) => {
    const x = cursor + actionWidth / 2
    cursor += actionWidth + (index < widths.length - 1 ? gap : 0)
    return x
  })
  return { size: { width, height }, timerX, actionXs }
}
