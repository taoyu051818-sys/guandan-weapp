export type HandDragPoint = Readonly<{ x: number, y: number }>

export type HandDragSegment = Readonly<{
  from: HandDragPoint
  to: HandDragPoint
}>

export type HandTapSelection = Readonly<{
  cardId: string
  selected: boolean
}>

type ActiveGesture = {
  pointerId: number
  startCardId: string
  desiredSelected: boolean
  start: HandDragPoint
  previous: HandDragPoint
  dragging: boolean
  visitedCardIds: Set<string>
}

const DRAG_THRESHOLD_SQUARED = 36
const MAX_SAMPLE_STEP = 8

/**
 * Stateful but engine-independent selection gesture policy. A drag adopts the
 * inverse state of its starting card and applies that state at most once to
 * every crossed physical card.
 */
export class HandDragSelectionPolicy {
  private gesture: ActiveGesture | null = null

  public begin (pointerId: number, cardId: string, selected: boolean, point: HandDragPoint): void {
    this.gesture = {
      pointerId,
      startCardId: cardId,
      desiredSelected: !selected,
      start: { x: point.x, y: point.y },
      previous: { x: point.x, y: point.y },
      dragging: false,
      visitedCardIds: new Set<string>(),
    }
  }

  public move (pointerId: number, point: HandDragPoint): HandDragSegment | null {
    const gesture = this.gesture
    if (!gesture || gesture.pointerId !== pointerId) return null
    const current = { x: point.x, y: point.y }
    if (!gesture.dragging) {
      const dx = current.x - gesture.start.x
      const dy = current.y - gesture.start.y
      if (dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED) return null
      gesture.dragging = true
      gesture.previous = gesture.start
    }
    const segment = { from: gesture.previous, to: current }
    gesture.previous = current
    return segment
  }

  /** Returns the drag's target state once per card, otherwise null. */
  public claim (cardId: string): boolean | null {
    const gesture = this.gesture
    if (!gesture || !gesture.dragging || gesture.visitedCardIds.has(cardId)) return null
    gesture.visitedCardIds.add(cardId)
    return gesture.desiredSelected
  }

  /** Ends a gesture. Non-drag gestures resolve to one ordinary card tap. */
  public end (pointerId: number): HandTapSelection | null {
    const gesture = this.gesture
    if (!gesture || gesture.pointerId !== pointerId) return null
    this.gesture = null
    return gesture.dragging
      ? null
      : { cardId: gesture.startCardId, selected: gesture.desiredSelected }
  }

  public cancel (pointerId?: number): void {
    if (pointerId === undefined || this.gesture?.pointerId === pointerId) this.gesture = null
  }
}

/** Samples fast pointer movement densely enough that narrow fanned cards cannot be skipped. */
export const sampleHandDragSegment = (segment: HandDragSegment): HandDragPoint[] => {
  const dx = segment.to.x - segment.from.x
  const dy = segment.to.y - segment.from.y
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / MAX_SAMPLE_STEP))
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: segment.from.x + dx * index / steps,
    y: segment.from.y + dy * index / steps,
  }))
}
