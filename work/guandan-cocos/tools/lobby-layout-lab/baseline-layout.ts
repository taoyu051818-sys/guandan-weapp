/** Engine-independent geometry. Defaults preserve the September 7 lobby exactly.
 * Lab overrides are never applied to the live game without an explicit approval. */
export type LobbySafeFrame = { width: number, height: number, left: number, right: number, top: number, bottom: number }
export type LobbyLayoutAdjustments = {
  cardsX: number, cardsY: number, cardScale: number, gapDelta: number,
  titleY: number, quickX: number, quickY: number, shopScale: number,
}
export const LOBBY_LAYOUT_BASELINE: Readonly<LobbyLayoutAdjustments> = Object.freeze({
  cardsX: 0, cardsY: 0, cardScale: 1, gapDelta: 0, titleY: 0, quickX: 0, quickY: 0, shopScale: 1,
})

export function resolveLobbyLayout (frame: LobbySafeFrame, overrides: Partial<LobbyLayoutAdjustments> = {}) {
  const a = { ...LOBBY_LAYOUT_BASELINE, ...overrides }
  const safeWidth = frame.width, safeHeight = frame.height
  const cardsAreaWidth = Math.min(650, safeWidth * 0.61)
  const baseGap = Math.max(10, Math.min(18, cardsAreaWidth * 0.028))
  const baseWidth = Math.min(190, (cardsAreaWidth - baseGap * 2) / 3)
  const baseFirst = frame.right - 22 - cardsAreaWidth + baseWidth / 2
  const titleX = baseFirst + (baseWidth * 3 + baseGap * 2) / 2 - baseWidth / 2 + a.cardsX
  const gap = baseGap + a.gapDelta
  const cardWidth = baseWidth * a.cardScale
  const cardHeight = cardWidth * 4 / 3
  const firstCardX = baseFirst + a.cardsX + (baseWidth - cardWidth) + (baseGap - gap)
  const cardY = Math.min(28, Math.max(-2, safeHeight * 0.025)) + a.cardsY
  const quickWidth = Math.min(286, Math.max(232, safeWidth * 0.225))
  const quickHeight = Math.min(76, Math.max(62, safeHeight * 0.105))
  const shopSize = Math.min(168, Math.max(92, Math.min(safeWidth * 0.14, safeHeight * 0.31))) * a.shopScale
  return {
    cardsAreaWidth, gap, cardWidth, cardHeight, firstCardX, cardY, titleX,
    titleY: frame.top - 52 + a.titleY,
    titleSize: Math.min(42, Math.max(31, safeHeight * 0.07)),
    profileRight: firstCardX - cardWidth / 2 - 14,
    utilityY: frame.top - 128,
    quickWidth, quickHeight,
    quickX: frame.right - quickWidth / 2 - 22 + a.quickX,
    quickY: frame.bottom + quickHeight / 2 + 18 + a.quickY,
    shopSize, shopX: frame.left + (shopSize / 2 + 18), shopY: frame.bottom + (shopSize / 2 + 16),
  }
}
