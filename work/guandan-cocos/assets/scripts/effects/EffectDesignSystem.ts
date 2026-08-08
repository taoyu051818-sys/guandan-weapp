import { Color } from 'cc'
import type { EffectLevel, EffectQuality } from './EffectTypes'

export type EffectColorTuple = readonly [number, number, number]
export type EffectIntent = 'system' | 'skill' | 'honor' | 'power' | 'royal' | 'neutral'
export type EffectPaletteName = EffectIntent | 'ink'
export type EffectPaletteTone = 'primary' | 'secondary' | 'highlight'

export type EffectPalette = Readonly<Record<EffectPaletteTone, EffectColorTuple>>

const rgb = (red: number, green: number, blue: number): EffectColorTuple =>
  Object.freeze([red, green, blue]) as EffectColorTuple

const palette = (primary: EffectColorTuple, secondary: EffectColorTuple, highlight: EffectColorTuple): EffectPalette =>
  Object.freeze({ primary, secondary, highlight })

/** "Island night table": jade interaction, cool skill light, gold honor and warm impact. */
export const EFFECT_PALETTES: Readonly<Record<EffectPaletteName, EffectPalette>> = Object.freeze({
  system: palette(rgb(66, 217, 181), rgb(154, 235, 213), rgb(232, 255, 248)),
  skill: palette(rgb(85, 223, 255), rgb(142, 241, 255), rgb(214, 252, 255)),
  honor: palette(rgb(255, 208, 82), rgb(255, 226, 132), rgb(255, 244, 190)),
  power: palette(rgb(255, 91, 36), rgb(255, 157, 55), rgb(255, 213, 106)),
  royal: palette(rgb(245, 200, 75), rgb(199, 55, 79), rgb(255, 238, 166)),
  neutral: palette(rgb(178, 194, 196), rgb(215, 225, 224), rgb(242, 246, 244)),
  ink: palette(rgb(2, 9, 13), rgb(10, 20, 24), rgb(30, 42, 45)),
})

const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

/** Cocos Color is mutable. Always return a fresh instance instead of exposing token state. */
export const rgba = (color: EffectColorTuple, alpha = 255): Color =>
  new Color(byte(color[0]), byte(color[1]), byte(color[2]), byte(alpha))

export const EFFECT_LAYERS = Object.freeze({
  DIMMER: 0,
  BACK_FX: 10,
  TRAIL: 20,
  SUBJECT: 30,
  CORE: 40,
  PARTICLE: 50,
  COPY: 60,
} as const)

export type EffectLayer = typeof EFFECT_LAYERS[keyof typeof EFFECT_LAYERS]

export type EffectTypeRole = 'micro' | 'caption' | 'badge' | 'title' | 'hero'
export type EffectTypeToken = Readonly<{
  fontSize: number
  lineHeight: number
  outlineWidth: number
  defaultWidth: number
}>

export const EFFECT_TYPE_SCALE: Readonly<Record<EffectTypeRole, EffectTypeToken>> = Object.freeze({
  micro: Object.freeze({ fontSize: 20, lineHeight: 26, outlineWidth: 2, defaultWidth: 260 }),
  caption: Object.freeze({ fontSize: 24, lineHeight: 30, outlineWidth: 2, defaultWidth: 360 }),
  badge: Object.freeze({ fontSize: 34, lineHeight: 42, outlineWidth: 2, defaultWidth: 560 }),
  title: Object.freeze({ fontSize: 46, lineHeight: 54, outlineWidth: 3, defaultWidth: 720 }),
  hero: Object.freeze({ fontSize: 54, lineHeight: 64, outlineWidth: 3, defaultWidth: 820 }),
})

export type EffectTimeline = Readonly<{
  anticipationMs: number
  impactAtMs: number
  settleAtMs: number
  releaseAtMs: number
  totalMs: number
  flashMs: number
}>

const timeline = (
  anticipationMs: number,
  impactAtMs: number,
  settleAtMs: number,
  releaseAtMs: number,
  totalMs: number,
  flashMs: number,
): EffectTimeline => Object.freeze({ anticipationMs, impactAtMs, settleAtMs, releaseAtMs, totalMs, flashMs })

export const EFFECT_TIMELINES: Readonly<Record<EffectLevel, EffectTimeline>> = Object.freeze({
  0: timeline(0, 0, 70, 140, 240, 60),
  1: timeline(40, 40, 140, 260, 420, 70),
  2: timeline(80, 80, 180, 480, 700, 70),
  3: timeline(100, 100, 210, 710, 970, 80),
})

export const EFFECT_EASING = Object.freeze({
  anticipation: 'sineIn',
  travel: 'quadInOut',
  travelOut: 'quadOut',
  travelIn: 'quadIn',
  impact: 'expoOut',
  settle: 'sineOut',
  release: 'quadIn',
  ambient: 'sineInOut',
  hero: 'backOut',
} as const)

export type EffectShakeToken = Readonly<{ amplitude: number, durationMs: number, impulses: number }>

export const EFFECT_SHAKE = Object.freeze({
  none: Object.freeze({ amplitude: 0, durationMs: 0, impulses: 0 }),
  light: Object.freeze({ amplitude: 3, durationMs: 120, impulses: 3 }),
  medium: Object.freeze({ amplitude: 6, durationMs: 170, impulses: 4 }),
  strong: Object.freeze({ amplitude: 9, durationMs: 220, impulses: 5 }),
} as const satisfies Readonly<Record<string, EffectShakeToken>>)

export type EffectBudget = Readonly<{
  globalNodeLimit: number
  particleLimit: number
  trailLimit: number
  smokeLimit: number
  ringLimit: number
  durationLimitMs: number
  allowDimmer: boolean
  allowShake: boolean
  allowTrails: boolean
  allowSmoke: boolean
}>

type QualityBudget = Readonly<{
  globalNodeLimit: number
  particles: readonly [number, number, number, number]
  trails: readonly [number, number, number, number]
  smoke: readonly [number, number, number, number]
  rings: readonly [number, number, number, number]
  durationLimitMs: number
  allowDimmer: boolean
  allowShake: boolean
  allowTrails: boolean
  allowSmoke: boolean
}>

const counts = (l0: number, l1: number, l2: number, l3: number): readonly [number, number, number, number] =>
  Object.freeze([l0, l1, l2, l3]) as readonly [number, number, number, number]

export const EFFECT_QUALITY_BUDGETS: Readonly<Record<EffectQuality, QualityBudget>> = Object.freeze({
  full: Object.freeze({
    globalNodeLimit: 96,
    particles: counts(2, 8, 24, 40),
    trails: counts(0, 1, 2, 2),
    smoke: counts(0, 0, 3, 5),
    rings: counts(1, 1, 2, 3),
    durationLimitMs: 1050,
    allowDimmer: true,
    allowShake: true,
    allowTrails: true,
    allowSmoke: true,
  }),
  reduced: Object.freeze({
    globalNodeLimit: 32,
    particles: counts(1, 3, 8, 12),
    trails: counts(0, 0, 0, 0),
    smoke: counts(0, 0, 0, 0),
    rings: counts(1, 1, 1, 1),
    durationLimitMs: 420,
    allowDimmer: false,
    allowShake: false,
    allowTrails: false,
    allowSmoke: false,
  }),
  off: Object.freeze({
    globalNodeLimit: 0,
    particles: counts(0, 0, 0, 0),
    trails: counts(0, 0, 0, 0),
    smoke: counts(0, 0, 0, 0),
    rings: counts(0, 0, 0, 0),
    durationLimitMs: 0,
    allowDimmer: false,
    allowShake: false,
    allowTrails: false,
    allowSmoke: false,
  }),
})

export type EffectStyle = Readonly<{
  profileKey: string
  level: EffectLevel
  quality: EffectQuality
  intent: EffectIntent
  palette: EffectPalette
  layers: typeof EFFECT_LAYERS
  typeScale: typeof EFFECT_TYPE_SCALE
  timeline: EffectTimeline
  easing: typeof EFFECT_EASING
  budget: EffectBudget
  dimmerAlpha: number
}>

const includesAny = (value: string, fragments: readonly string[]): boolean => fragments.some(fragment => value.includes(fragment))

export const resolveEffectIntent = (profileKey: string): EffectIntent => {
  const key = profileKey.trim().toLowerCase()
  if (includesAny(key, ['king-bomb', 'wildcard', 'rocket'])) return 'royal'
  if (includesAny(key, ['bomb', 'explosion'])) return 'power'
  if (includesAny(key, ['straight-flush', 'straight', 'tube', 'plate', 'combo'])) return 'skill'
  if (includesAny(key, ['victory', 'upgrade', 'grade', 'tribute', 'player-finished', 'finish'])) return 'honor'
  if (includesAny(key, ['defeat', 'trustee-off', 'cancel', 'disabled'])) return 'neutral'
  return 'system'
}

const normalizeLevel = (level: EffectLevel): EffectLevel => Math.max(0, Math.min(3, Math.round(level))) as EffectLevel

const scaleTimeline = (source: EffectTimeline, durationLimitMs: number): EffectTimeline => {
  if (durationLimitMs <= 0) return timeline(0, 0, 0, 0, 0, 0)
  const totalMs = Math.min(source.totalMs, durationLimitMs)
  if (totalMs === source.totalMs) return source
  const ratio = totalMs / source.totalMs
  const scaled = (value: number): number => Math.round(value * ratio)
  return timeline(
    scaled(source.anticipationMs),
    scaled(source.impactAtMs),
    scaled(source.settleAtMs),
    scaled(source.releaseAtMs),
    totalMs,
    Math.max(1, scaled(source.flashMs)),
  )
}

const dimmerAlpha = (intent: EffectIntent, level: EffectLevel, allowDimmer: boolean): number => {
  if (!allowDimmer || level < 2) return 0
  if (intent === 'power') return level === 3 ? 156 : 120
  if (intent === 'royal') return 144
  if (intent === 'skill') return 100
  return 96
}

export const resolveEffectStyle = (profileKey: string, requestedLevel: EffectLevel, quality: EffectQuality): EffectStyle => {
  const level = normalizeLevel(requestedLevel)
  const intent = resolveEffectIntent(profileKey)
  const qualityBudget = EFFECT_QUALITY_BUDGETS[quality]
  const durationLimitMs = Math.min(EFFECT_TIMELINES[level].totalMs, qualityBudget.durationLimitMs)
  const budget: EffectBudget = Object.freeze({
    globalNodeLimit: qualityBudget.globalNodeLimit,
    particleLimit: qualityBudget.particles[level],
    trailLimit: qualityBudget.trails[level],
    smokeLimit: qualityBudget.smoke[level],
    ringLimit: qualityBudget.rings[level],
    durationLimitMs,
    allowDimmer: qualityBudget.allowDimmer,
    allowShake: qualityBudget.allowShake,
    allowTrails: qualityBudget.allowTrails,
    allowSmoke: qualityBudget.allowSmoke,
  })
  return Object.freeze({
    profileKey,
    level,
    quality,
    intent,
    palette: EFFECT_PALETTES[intent],
    layers: EFFECT_LAYERS,
    typeScale: EFFECT_TYPE_SCALE,
    timeline: scaleTimeline(EFFECT_TIMELINES[level], durationLimitMs),
    easing: EFFECT_EASING,
    budget,
    dimmerAlpha: dimmerAlpha(intent, level, budget.allowDimmer),
  })
}

export const clampEffectCount = (requested: number, limit: number): number =>
  Math.max(0, Math.min(Math.floor(requested), Math.floor(limit)))
