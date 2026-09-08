import type { Card, PlayerId } from '../core/generated'
import type { EffectQuality } from './EffectTypes'

export type FlowEffectKind =
  | 'deal'
  | 'grade'
  | 'trustee-on'
  | 'trustee-off'
  | 'chat-left'
  | 'chat-right'
  | 'tribute'
  | 'return-tribute'
  | 'anti-tribute'
  | 'player-finished'
  | 'upgrade'
  | 'victory'
  | 'defeat'
  | 'match-success'

export type FlowEffectRecipe = Readonly<{
  kind: FlowEffectKind
  durationMs: number
  major: boolean
  dimTable: boolean
  pulseCount: number
}>

export type TributeFlowEvent = Readonly<{
  phase: 'tribute' | 'return' | 'anti-tribute'
  from: PlayerId
  to: PlayerId
  card: Card | null
}>

/** @deprecated 未达到商业化标准，流程视觉已卸载，禁止恢复运行时 recipe。 */
export const resolveFlowEffectRecipe = (_kind: FlowEffectKind, _quality: EffectQuality): FlowEffectRecipe | null => null
