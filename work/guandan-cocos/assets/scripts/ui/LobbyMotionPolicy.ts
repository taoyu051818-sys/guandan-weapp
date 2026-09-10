/** Decoration only: no timers, input state or gameplay dependencies. */
export const LOBBY_MOTION = Object.freeze({ delay: 1, repeatDelay: 1, frames: 16, fps: 15, cell: 48, columns: 8 })
export type LobbyMotionClock = { elapsed: number }

/** Returning from interruption starts with quiet time, never catches up missed effects. */
export function stepLobbyMotion (clock: LobbyMotionClock, dt: number, allowed: boolean): number {
  if (!allowed) { clock.elapsed = 0; return -1 }
  if (!Number.isFinite(dt) || dt < 0 || dt > .25) return -1
  clock.elapsed += dt
  if (clock.elapsed < LOBBY_MOTION.delay) return -1
  const duration = LOBBY_MOTION.frames / LOBBY_MOTION.fps
  // Preserve the complete animation, then leave one second between flashes.
  const phase = (clock.elapsed - LOBBY_MOTION.delay) % (duration + LOBBY_MOTION.repeatDelay)
  return phase < duration ? Math.floor(phase * LOBBY_MOTION.fps) : -1
}
