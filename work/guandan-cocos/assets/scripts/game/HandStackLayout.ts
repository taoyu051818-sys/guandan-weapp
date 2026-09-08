export type HandGroupBadge = Readonly<{ label: string, tone: 'cyan' | 'purple' }>

export type HandStackGroup = Readonly<{
  id: string
  cardIds: readonly string[]
  /** Present on live HandGrouping projections; omitted by layout-only callers. */
  locked?: boolean
  /** Relative sorting category only; never reserves a fixed horizontal region. */
  zone?: 0 | 1 | 2
  badge?: HandGroupBadge
}>

export type HandStackSlot = Readonly<{
  cardId: string
  laneIndex: number
  stackId: string | null
  stackIndex: number
  stackSize: number
  stackStep: number
  /** Actual distance to the next lane, shared by visual and touch layout. */
  nextLaneSpacing: number
  x: number
  y: number
}>

export type HandStackLayout = Readonly<{
  slots: readonly HandStackSlot[]
  laneCount: number
  laneSpacing: number
  maxRise: number
}>

const MAX_LANE_SPACING = 68
/**
 * Every covered card exposes the same 40px point strip. The value is large
 * enough for the 27x36 classic point artwork plus a small visual margin.
 * It deliberately does not shrink for large stacks.
 */
export const STACK_EXPOSURE_HEIGHT = 40

/**
 * Grouping decides which physical point owns a lane. Layout is deliberately
 * rank-agnostic: stack size and index alone determine the exposed height.
 */
export const handStackStep = (cardCount: number): number => {
  if (cardCount < 2) return 0
  return STACK_EXPOSURE_HEIGHT
}

export const handStackRise = (cardCount: number): number => handStackStep(cardCount) * Math.max(0, cardCount - 1)

const lanePositions = (count: number, width: number): number[] => {
  const spacing = count <= 1 ? 0 : Math.min(MAX_LANE_SPACING, width / (count - 1))
  // Centre the occupied lanes as one pack, including tall combinations. Sorting
  // owns relative order; no type or empty category can pin cards to either side.
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * spacing)
}

/**
 * Produces presentation-only slots. A group consumes one horizontal lane. Its
 * first card starts above the normal hand baseline and later cards cascade
 * downward, exposing the rank/suit corner of every preceding card.
 */
export const createHandStackLayout = (
  displayCardIds: readonly string[],
  requestedGroups: readonly HandStackGroup[],
  availableWidth: number,
): HandStackLayout => {
  const displaySet = new Set(displayCardIds)
  const claimed = new Set<string>()
  const groups = requestedGroups.flatMap(group => {
    const cardIds = group.cardIds.filter(cardId => displaySet.has(cardId) && !claimed.has(cardId))
    cardIds.forEach(cardId => claimed.add(cardId))
    return cardIds.length >= 2 ? [{ id: group.id, cardIds }] : []
  })
  const groupByCard = new Map(groups.flatMap(group => group.cardIds.map(cardId => [cardId, group] as const)))
  const lanes: Array<{ stackId: string | null, cardIds: string[] }> = []
  const addedStacks = new Set<string>()
  displayCardIds.forEach(cardId => {
    const group = groupByCard.get(cardId)
    if (!group) {
      lanes.push({ stackId: null, cardIds: [cardId] })
      return
    }
    if (addedStacks.has(group.id)) return
    addedStacks.add(group.id)
    lanes.push({ stackId: group.id, cardIds: group.cardIds.slice() })
  })

  const laneCount = lanes.length
  const width = Number.isFinite(availableWidth) ? Math.max(1, availableWidth) : 940
  const positions = lanePositions(laneCount, width)
  const laneSpacing = laneCount <= 1 ? 0 : Math.min(...positions.slice(1).map((x, index) => x - positions[index]))
  const slots: HandStackSlot[] = []
  let maxRise = 0
  lanes.forEach((lane, laneIndex) => {
    const step = handStackStep(lane.cardIds.length)
    maxRise = Math.max(maxRise, handStackRise(lane.cardIds.length))
    lane.cardIds.forEach((cardId, stackIndex) => {
      slots.push({
        cardId,
        laneIndex,
        stackId: lane.stackId,
        stackIndex,
        stackSize: lane.cardIds.length,
        stackStep: step,
        nextLaneSpacing: laneIndex < laneCount - 1 ? positions[laneIndex + 1] - positions[laneIndex] : 78,
        x: positions[laneIndex],
        y: (lane.cardIds.length - 1 - stackIndex) * step,
      })
    })
  })
  const slotByCard = new Map(slots.map(slot => [slot.cardId, slot]))
  return {
    slots: displayCardIds.map(cardId => slotByCard.get(cardId)).filter((slot): slot is HandStackSlot => Boolean(slot)),
    laneCount,
    laneSpacing,
    maxRise,
  }
}
