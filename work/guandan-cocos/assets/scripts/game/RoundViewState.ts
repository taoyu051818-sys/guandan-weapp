import type { EngineState, SettlementResult, TributeState } from '../core/generated'
import { snapshotData } from '../services/DataSnapshot'

/** Phase-specific data cannot contradict the visible lifecycle. */
export type RoundViewPhase =
  | Readonly<{ phase: 'playing', tribute: null, settlement: null }>
  | Readonly<{ phase: 'tribute', tribute: TributeState, settlement: null }>
  | Readonly<{ phase: 'settlement', tribute: null, settlement: SettlementResult }>

/** Wire compatibility input only. Never expose this partial shape to presenters. */
export type RoundViewPhasePatch = {
  phase?: RoundViewPhase['phase']
  tribute?: TributeState | null
  settlement?: SettlementResult | null
}

export function normalizeRoundViewPhase (input: RoundViewPhasePatch): RoundViewPhase | null {
  if (input.phase === 'playing') return { phase: 'playing', tribute: null, settlement: null }
  if (input.phase === 'tribute' && input.tribute) return { phase: 'tribute', tribute: input.tribute, settlement: null }
  if (input.phase === 'settlement' && input.settlement) return { phase: 'settlement', tribute: null, settlement: input.settlement }
  return null
}

/** Copy/freeze once per accepted packet, never per render. Core read APIs retain EngineState signatures. */
export function ownRoundState (state: EngineState): EngineState {
  return snapshotData<EngineState>(state) as EngineState
}
