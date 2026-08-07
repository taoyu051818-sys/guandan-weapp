export type SafeHorizontalLaneItem = Readonly<{
  id: string
  preferredWidth: number
  minWidth: number
  priority: number
  canHide?: boolean
}>

export type SafeHorizontalLanePlacement = Readonly<{
  id: string
  x: number
  width: number
  visible: boolean
}>

export type SafeRect = Readonly<{ left: number, right: number, top: number, bottom: number }>

export type SafePriorityRectItem = Readonly<{
  id: string
  x: number
  y: number
  width: number
  height: number
  priority: number
  shiftAxis?: 'x' | 'y'
  shiftStep?: number
  maxShift?: number
  canHide?: boolean
}>

export type SafePriorityRectPlacement = Readonly<{
  id: string
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}>

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback
const positive = (value: number, fallback = 1): number => Math.max(1, finite(value, fallback))

/**
 * Keeps the visual order stable while allowing low-priority fields to shrink
 * and then leave the lane before protected identity fields are disturbed.
 */
export const resolveSafeHorizontalLane = (
  left: number,
  right: number,
  items: readonly SafeHorizontalLaneItem[],
  gap = 8,
): SafeHorizontalLanePlacement[] => {
  const laneLeft = Math.min(finite(left), finite(right))
  const laneRight = Math.max(finite(left), finite(right))
  const laneWidth = Math.max(1, laneRight - laneLeft)
  const safeGap = Math.max(0, finite(gap))
  const working = items.map((item, index) => {
    const minimum = positive(Math.min(item.preferredWidth, item.minWidth))
    return {
      item,
      index,
      width: Math.max(minimum, positive(item.preferredWidth)),
      minimum,
      visible: true,
    }
  })
  const usedWidth = (): number => {
    const visible = working.filter(entry => entry.visible)
    return visible.reduce((sum, entry) => sum + entry.width, 0) + Math.max(0, visible.length - 1) * safeGap
  }

  let overflow = Math.max(0, usedWidth() - laneWidth)
  const lowerPriorityFirst = [...working].sort((a, b) => a.item.priority - b.item.priority || b.index - a.index)
  lowerPriorityFirst.forEach(entry => {
    if (overflow <= 0) return
    const available = Math.max(0, entry.width - entry.minimum)
    const reduction = Math.min(overflow, available)
    entry.width -= reduction
    overflow -= reduction
  })
  lowerPriorityFirst.forEach(entry => {
    if (overflow <= 0 || entry.item.canHide === false) return
    entry.visible = false
    overflow = Math.max(0, usedWidth() - laneWidth)
  })

  // Protected entries cannot leave the safe lane. When their declared minimums
  // still exceed it, squeeze lower-priority protected fields before identity.
  overflow = Math.max(0, usedWidth() - laneWidth)
  lowerPriorityFirst.forEach(entry => {
    if (overflow <= 0 || !entry.visible) return
    const available = Math.max(0, entry.width - 1)
    const reduction = Math.min(overflow, available)
    entry.width -= reduction
    overflow -= reduction
  })

  const visibleCount = working.filter(entry => entry.visible).length
  const contentWidth = working.filter(entry => entry.visible).reduce((sum, entry) => sum + entry.width, 0)
  const layoutGap = visibleCount > 1
    ? Math.min(safeGap, Math.max(0, (laneWidth - contentWidth) / (visibleCount - 1)))
    : 0

  let cursor = laneLeft
  return working.map(entry => {
    if (!entry.visible) return { id: entry.item.id, x: laneRight, width: 0, visible: false }
    const width = Math.min(entry.width, Math.max(1, laneRight - cursor))
    const x = cursor + width / 2
    cursor = Math.min(laneRight, cursor + width + layoutGap)
    return { id: entry.item.id, x, width, visible: true }
  })
}

const clampCenter = (value: number, start: number, end: number, size: number): number => {
  const half = size / 2
  if (end - start <= size) return (start + end) / 2
  return Math.max(start + half, Math.min(end - half, value))
}

const intersects = (a: SafePriorityRectPlacement, b: SafePriorityRectPlacement, padding: number): boolean => (
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 + padding &&
  Math.abs(a.y - b.y) < (a.height + b.height) / 2 + padding
)

/**
 * Places high-priority rectangles first. Lower-priority rectangles search the
 * requested axis for a safe slot and hide when no collision-free slot exists.
 */
export const resolveSafePriorityRects = (
  safe: SafeRect,
  items: readonly SafePriorityRectItem[],
  padding = 6,
): SafePriorityRectPlacement[] => {
  const bounds = {
    left: Math.min(finite(safe.left), finite(safe.right)),
    right: Math.max(finite(safe.left), finite(safe.right)),
    bottom: Math.min(finite(safe.bottom), finite(safe.top)),
    top: Math.max(finite(safe.bottom), finite(safe.top)),
  }
  const placed: SafePriorityRectPlacement[] = []
  const byId = new Map<string, SafePriorityRectPlacement>()
  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) => b.item.priority - a.item.priority || a.index - b.index)
  ordered.forEach(({ item }) => {
    const width = Math.min(positive(item.width), Math.max(1, bounds.right - bounds.left))
    const height = Math.min(positive(item.height), Math.max(1, bounds.top - bounds.bottom))
    const originX = clampCenter(finite(item.x), bounds.left, bounds.right, width)
    const originY = clampCenter(finite(item.y), bounds.bottom, bounds.top, height)
    const step = positive(item.shiftStep ?? 16)
    const maxShift = Math.max(0, finite(item.maxShift ?? 0))
    const attempts = Math.floor(maxShift / step)
    const offsets = [0]
    for (let index = 1; index <= attempts; index += 1) offsets.push(-index * step, index * step)
    let accepted: SafePriorityRectPlacement | null = null
    offsets.some(offset => {
      const x = item.shiftAxis === 'x' ? clampCenter(originX + offset, bounds.left, bounds.right, width) : originX
      const y = item.shiftAxis === 'y' ? clampCenter(originY + offset, bounds.bottom, bounds.top, height) : originY
      const candidate = { id: item.id, x, y, width, height, visible: true }
      if (placed.every(existing => !intersects(candidate, existing, Math.max(0, padding)))) {
        accepted = candidate
        return true
      }
      return false
    })
    const result = accepted ?? {
      id: item.id,
      x: originX,
      y: originY,
      width,
      height,
      visible: item.canHide === false,
    }
    if (result.visible) placed.push(result)
    byId.set(item.id, result)
  })
  return items.map(item => byId.get(item.id)!)
}
