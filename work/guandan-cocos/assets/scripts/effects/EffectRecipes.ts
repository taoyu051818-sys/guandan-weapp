import type { EffectQuality } from './EffectTypes'

export type BombEffectKey = 'bomb-small' | 'bomb-medium' | 'bomb-large'
export type SixBombEffectKey = 'six-bomb'

export type BombEffectRecipe = Readonly<{
  key: BombEffectKey
  ringCount: number
  sparkCount: number
  flameCount: number
  smokeCount: number
  flashAlpha: number
  scale: number
  durationMs: number
}>

export type SixBombEffectRecipe = Readonly<{
  key: SixBombEffectKey
  crackCount: number
  shockwaveCount: number
  sparkCount: number
  flameCount: number
  smokeCount: number
  dimAlpha: number
  durationMs: number
}>

const BOMB_RECIPES: Readonly<Record<BombEffectKey, BombEffectRecipe>> = Object.freeze({
  'bomb-small': Object.freeze({ key: 'bomb-small', ringCount: 1, sparkCount: 7, flameCount: 3, smokeCount: 1, flashAlpha: 80, scale: 0.92, durationMs: 520 }),
  'bomb-medium': Object.freeze({ key: 'bomb-medium', ringCount: 2, sparkCount: 11, flameCount: 5, smokeCount: 2, flashAlpha: 108, scale: 1.12, durationMs: 620 }),
  'bomb-large': Object.freeze({ key: 'bomb-large', ringCount: 3, sparkCount: 17, flameCount: 7, smokeCount: 3, flashAlpha: 138, scale: 1.34, durationMs: 760 }),
})

const SIX_BOMB_RECIPE: SixBombEffectRecipe = Object.freeze({
  key: 'six-bomb',
  crackCount: 12,
  shockwaveCount: 3,
  sparkCount: 20,
  flameCount: 8,
  smokeCount: 5,
  dimAlpha: 178,
  durationMs: 1040,
})

/** Pure art-direction data, kept outside Cocos nodes so it can be regression tested. */
export const resolveBombRecipe = (key: BombEffectKey, quality: EffectQuality): BombEffectRecipe | null => {
  if (quality === 'off') return null
  const source = BOMB_RECIPES[key]
  if (quality === 'full') return source
  return Object.freeze({
    ...source,
    ringCount: 1,
    sparkCount: Math.min(4, source.sparkCount),
    flameCount: 0,
    smokeCount: 0,
    flashAlpha: 0,
    scale: Math.min(0.9, source.scale),
    durationMs: Math.min(360, source.durationMs),
  })
}

/** Six-card bombs keep their identity in reduced mode while shedding costly layers. */
export const resolveSixBombRecipe = (quality: EffectQuality): SixBombEffectRecipe | null => {
  if (quality === 'off') return null
  if (quality === 'full') return SIX_BOMB_RECIPE
  return Object.freeze({
    ...SIX_BOMB_RECIPE,
    crackCount: 4,
    shockwaveCount: 1,
    sparkCount: 4,
    flameCount: 0,
    smokeCount: 0,
    dimAlpha: 0,
    durationMs: 400,
  })
}

export const isBombEffectKey = (key: string): key is BombEffectKey => key === 'bomb-small' || key === 'bomb-medium' || key === 'bomb-large'
export const isSixBombEffectKey = (key: string): key is SixBombEffectKey => key === 'six-bomb'
