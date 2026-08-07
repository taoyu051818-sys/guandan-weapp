import type { Card, PlayAction, PlayerId } from '../core/generated'
import type { Vec3 } from 'cc'
import type { AudioEvent } from '../audio/AudioProfiles'

export type EffectQuality = 'full' | 'reduced' | 'off'
export type EffectLevel = 0 | 1 | 2 | 3
export type ShakeStrength = 'none' | 'light' | 'medium' | 'strong'

export type EffectProfile = {
  key: string
  level: EffectLevel
  label: string
  durationMs: number
  flightMs: number
  shake: ShakeStrength
  sound: AudioEvent | null
  haptic: 'none' | 'light' | 'medium' | 'heavy'
  dimTable: boolean
  color: readonly [number, number, number]
}

export type CardFlightOrigin = { cardId: string, worldPosition: Vec3 }

export type PlayEffectEvent = {
  action: PlayAction
  actionIndex: number
  humanId: PlayerId
  sourcePositions: Vec3[]
  targetWorldPosition: Vec3
  onFlightStart?: () => void
  onCardArrive?: (card: Card, cardIndex: number) => void
  onFlightFinish?: () => void
}

export { mapCardToPresentation as cardDisplay } from '../ui/CardPresentationMapper'
