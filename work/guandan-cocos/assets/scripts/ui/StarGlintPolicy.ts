/** One tuning point for the supplied metallic cross glint. Sizes are design pixels. */
export const STAR_GLINT_TEXTURE = 'effects/lobby-v1/metal-star-glint/texture'
export type StarGlintProfile = Readonly<{ size: number, strength: number, delay: number, duration: number, period: number }>
export type StarGlintClock = { elapsed: number, completed?: boolean }
export type StarGlintPoint = Readonly<{ x: number, y: number, profile: StarGlintProfile }>
export type StarGlintSequence = readonly StarGlintPoint[]
/** Shared small/main/tail rhythm. Anchors use normalized, top-left artwork coordinates. */
export function createStarGlintSequence (size: number, strength: number, offset: number,
  anchors: readonly [readonly [number, number], readonly [number, number], readonly [number, number]]): StarGlintSequence {
  return Object.freeze(anchors.map(([x, y], i) => Object.freeze({ x, y, profile: Object.freeze({
    size: size * [.4, 1, .65][i], strength: strength * [.75, 1, .85][i],
    delay: offset + [0, .3, 1][i], duration: [.6, .85, .65][i], period: 2.2,
  }) })))
}

// Full-size tournament artwork: left rim, bright cup lip, then right handle.
export const TOURNAMENT_TROPHY_GLINT = createStarGlintSequence(132, .95, .15, [[.23, .09], [.55, .09], [.85, .23]])
export const STAR_GLINT = Object.freeze({
  victory: { size: 110, strength: 1, delay: .3, duration: .9, period: 0 },
} satisfies Record<string, StarGlintProfile>)

/** A real fade to zero; no permanently lit rays and no catching up after background stalls. */
export function stepStarGlint (clock: StarGlintClock, dt: number, allowed: boolean, profile: StarGlintProfile): number {
  if (!allowed || !Number.isFinite(dt) || dt < 0 || dt > .25) { clock.elapsed = 0; return 0 }
  if (clock.completed) return 0
  clock.elapsed += dt
  const strength = sampleStarGlint(clock.elapsed, profile)
  if (!profile.period && clock.elapsed >= profile.delay + profile.duration) clock.completed = true
  return strength
}

/** Pure sampling lets several points share one clock without advancing it per point. */
export function sampleStarGlint (elapsed: number, profile: StarGlintProfile): number {
  const age = elapsed - profile.delay
  if (age < 0) return 0
  if (!profile.period && age >= profile.duration) return 0
  const phase = profile.period ? age % profile.period : age
  if (phase >= profile.duration) return 0
  return Math.pow(Math.sin(Math.PI * phase / profile.duration), 1.65) * profile.strength
}
