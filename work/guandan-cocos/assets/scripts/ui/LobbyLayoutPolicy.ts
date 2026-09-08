/** Approved September 7 lobby, in 874 × 402 design pixels. No historical variants ship. */
export type LobbySafeFrame = { width: number, height: number, left: number, right: number, top: number, bottom: number }
export type LobbyRect = Readonly<{ x: number, y: number, width: number, height: number }>
export const LOBBY_DESIGN = Object.freeze({
  width: 874, height: 402,
  classic: Object.freeze({ left: 448, top: 90, width: 184, height: 222 }),
  friend: Object.freeze({ left: 646, top: 90, width: 188, height: 142 }),
  tournament: Object.freeze({ left: 646, top: 244, width: 188, height: 68 }),
  quick: Object.freeze({ left: 624, top: 338, width: 210, height: 46 }),
  account: Object.freeze({ left: 4, top: 6, width: 180, height: 58 }),
  shop: Object.freeze({ left: 18, top: 316, width: 70, height: 70 }),
  shopFontSize: 15.4, shopOutline: 1.89, shopFadeStart: 50.8 / 70,
})

/** Uniform fit preserves the approved proportions on wider/taller and safe-area screens. */
export function resolveLobbyLayout (frame: LobbySafeFrame) {
  const scale = Math.min(frame.width / LOBBY_DESIGN.width, frame.height / LOBBY_DESIGN.height)
  const left = (frame.left + frame.right - LOBBY_DESIGN.width * scale) / 2
  const top = (frame.top + frame.bottom + LOBBY_DESIGN.height * scale) / 2
  const point = (x: number, y: number) => ({ x: left + x * scale, y: top - y * scale })
  const rect = (r: { left: number, top: number, width: number, height: number }): LobbyRect => ({
    ...point(r.left + r.width / 2, r.top + r.height / 2), width: r.width * scale, height: r.height * scale,
  })
  return { scale, point, classic: rect(LOBBY_DESIGN.classic), friend: rect(LOBBY_DESIGN.friend),
    tournament: rect(LOBBY_DESIGN.tournament), quick: rect(LOBBY_DESIGN.quick),
    account: rect(LOBBY_DESIGN.account), shop: rect(LOBBY_DESIGN.shop) }
}
export type LobbyLayout = ReturnType<typeof resolveLobbyLayout>
