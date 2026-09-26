import { LOBBY_MOTION } from './LobbyMotionPolicy'
import { createStarGlintSequence as sequence } from './StarGlintPolicy'
// Normalized artwork coordinates, top-left origin. No placement on text or faces.

export const LOBBY_STAR_GLINT = Object.freeze({
  quickStart: sequence(96, 1, 0, [[.06, .13], [.94, .13], [.91, .87]]),
  friend: sequence(78, .95, .55, [[.23, .34], [.52, .07], [.82, .38]]),
  shop: sequence(46, .92, 1.1, [[.44, .44], [.62, .17], [.83, .57]]),
  trophy: sequence(68, .95, 1.65, [[.23, .21], [.43, .24], [.72, .25]]),
})

/** Leave the original quick-start sheet untouched; soften glints at its bright middle. */
export function quickStartGlintGain (sheetElapsed: number): number {
  if (sheetElapsed < LOBBY_MOTION.delay) return 1
  const duration = LOBBY_MOTION.frames / LOBBY_MOTION.fps
  const phase = (sheetElapsed - LOBBY_MOTION.delay) % (duration + LOBBY_MOTION.repeatDelay)
  return phase < duration ? 1 - .45 * Math.sin(Math.PI * phase / duration) ** 2 : 1
}
