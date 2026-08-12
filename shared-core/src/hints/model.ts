import type { Card, PlayAction } from '../types/game'
import type { RuleProfile } from '../lib/rules'

export type HintProtectionKind = 'locked' | 'rocket' | 'bomb' | 'structured' | 'triple' | 'pair'

export type HintProtectedGroup = Readonly<{
  id: string
  kind: HintProtectionKind
  cardIds: readonly string[]
}>

export type HintRequest = Readonly<{
  hand: readonly Card[]
  lastPlay: PlayAction | null
  ruleProfile: RuleProfile
  protectedGroups: readonly HintProtectedGroup[]
}>

export type HintDamage = Readonly<{
  splitsLockedGroup: boolean
  splitRocketCount: number
  splitBombCount: number
  usesRocket: boolean
  usesBomb: boolean
  splitStructuredCount: number
  splitTripleCount: number
  splitPairCount: number
  wildcardCount: number
  beatMargin: number
  score: number
}>

export type RankedHintMove = Readonly<{
  cards: readonly Card[]
  damage: HintDamage
  warning: 'splits-locked-group' | null
}>
