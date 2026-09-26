/** Shared by the offline atlas builder and the small runtime player. */
export const CLASSIC_ENTRY_ANIMATION = Object.freeze({
  frames: 48, fps: 12,
  width: 360, height: 332, padding: 2, columns: 4, rows: 4, pages: 3,
  assetPrefix: 'effects/lobby-v1/classic-entry-idle-',
})
export type ClassicEntryClock = { elapsed: number, playing: boolean }

/** Loop continuously once ready; restart at frame zero after an interruption. */
export function stepClassicEntry (clock: ClassicEntryClock, dt: number, allowed: boolean): number {
  clock.playing = false
  if (!allowed || !Number.isFinite(dt) || dt < 0 || dt > .25) { clock.elapsed = 0; return 0 }
  const p = CLASSIC_ENTRY_ANIMATION
  clock.elapsed = (clock.elapsed + dt) % (p.frames / p.fps)
  clock.playing = true
  return Math.min(p.frames - 1, Math.floor(clock.elapsed * p.fps + 1e-7))
}

export function classicEntryFrameRect (index: number) {
  const p = CLASSIC_ENTRY_ANIMATION, perPage = p.columns * p.rows
  const cell = index % perPage
  return { page: Math.floor(index / perPage), x: cell % p.columns * (p.width + 2 * p.padding) + p.padding,
    y: Math.floor(cell / p.columns) * (p.height + 2 * p.padding) + p.padding, width: p.width, height: p.height }
}
