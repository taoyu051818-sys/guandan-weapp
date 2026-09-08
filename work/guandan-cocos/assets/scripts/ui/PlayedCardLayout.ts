import { TABLE_HUD_TURN_OPERATION_ANCHORS, resolveTableHudBounds, type TableHudSeatPlace, type TableHudViewport } from './TableHudLayoutPolicy'

export const PLAYED_CARD_SCALE = 0.8
export const playedCardSpacing = (count: number): number => Math.min(42, 210 / Math.max(1, count - 1))

/** Side fans grow inwards from the avatar, with the card/portrait bottom aligned. */
export const playedCardPosition = (viewport: TableHudViewport, place: number, cardCount = 1): { x: number, y: number } => {
  const bounds = resolveTableHudBounds(viewport)
  const centerX = ((viewport.safeLeft ?? 0) - (viewport.safeRight ?? 0)) / 2
  if (place === 0 || place === 2) return { x: centerX + 72, y: place === 0 ? 86 : 185 }
  const halfFan = (82 + Math.max(0, cardCount - 1) * playedCardSpacing(cardCount)) * PLAYED_CARD_SCALE / 2
  const avatarInnerOffset = 12 + (78 + 36) * bounds.scale
  const inset = avatarInnerOffset + 18 + halfFan
  return { x: place === 1 ? bounds.right - inset : bounds.left + inset,
    y: 16 - 6 * bounds.scale + 118 * PLAYED_CARD_SCALE / 2 }
}

/** Waiting clock occupies the avatar-side card slot, not a separate upper lane.
 * Use one card's anchor: the next combination is unknown and must not move it.
 */
export const turnTimerPosition = (viewport: TableHudViewport, place: TableHudSeatPlace): { x: number, y: number } => {
  if (place === 'right' || place === 'left') return playedCardPosition(viewport, place === 'right' ? 1 : 3)
  return TABLE_HUD_TURN_OPERATION_ANCHORS[place]
}
