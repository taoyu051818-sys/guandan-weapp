/** Decoration only: no timers, input state or gameplay dependencies. */
export const LOBBY_MOTION = Object.freeze({
  delay: 1, repeatDelay: 2, frames: 16, fps: 15,
  frameWidth: 210, frameHeight: 46, columns: 4, rows: 4,
  // The supplied sheet has a fixed transparent border, not button padding.
  contentInset: 5,
  texture: 'effects/lobby-v1/quick_start_star_fx_210_sheet/texture',
})
export type LobbyMotionClock = { elapsed: number }

/** Returning from interruption starts with quiet time, never catches up missed effects. */
export function stepLobbyMotion (clock: LobbyMotionClock, dt: number, allowed: boolean): number {
  if (!allowed) { clock.elapsed = 0; return -1 }
  if (!Number.isFinite(dt) || dt < 0 || dt > .25) { clock.elapsed = 0; return -1 }
  clock.elapsed += dt
  if (clock.elapsed < LOBBY_MOTION.delay) return -1
  const duration = LOBBY_MOTION.frames / LOBBY_MOTION.fps
  // 16 / 15 seconds of animation, then two seconds with the sprite hidden.
  const phase = (clock.elapsed - LOBBY_MOTION.delay) % (duration + LOBBY_MOTION.repeatDelay)
  return phase < duration ? Math.floor(phase * LOBBY_MOTION.fps) : -1
}
