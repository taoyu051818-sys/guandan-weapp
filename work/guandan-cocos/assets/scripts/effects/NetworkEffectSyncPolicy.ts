export type NetworkRecoveryReason =
  | 'initial-snapshot'
  | 'reconnect'
  | 'version-gap'
  | 'action-gap'
  | 'round-reset'

export type ForcedNetworkRecoveryReason = Extract<NetworkRecoveryReason, 'initial-snapshot' | 'reconnect' | 'round-reset'>

export type NetworkEffectSync =
  | Readonly<{ mode: 'incremental' }>
  | Readonly<{ mode: 'recovery', reason: NetworkRecoveryReason }>

export type NetworkEffectCursor = Readonly<{
  roomId: string
  version: number
  actionCount: number
}>

export type NetworkEffectObservation = Readonly<{
  roomId: string
  version: number
  actionCount: number
  forceRecovery?: ForcedNetworkRecoveryReason
}>

export type NetworkEffectDecision =
  | Readonly<{ kind: 'drop', cursor: NetworkEffectCursor }>
  | Readonly<{ kind: 'apply', cursor: NetworkEffectCursor, sync: NetworkEffectSync }>

export type ActionEffectSync = 'baseline' | 'duplicate' | 'play-next' | 'recovery'

const recovery = (cursor: NetworkEffectCursor, reason: NetworkRecoveryReason): NetworkEffectDecision => ({
  kind: 'apply',
  cursor,
  sync: { mode: 'recovery', reason },
})

/**
 * Classifies authoritative snapshots before they reach presentation code.
 * A missing version or action is recovered by showing only the final state;
 * only a contiguous update may produce a transient play effect.
 */
export const decideNetworkEffectSync = (
  previous: NetworkEffectCursor | null,
  observation: NetworkEffectObservation,
): NetworkEffectDecision => {
  const cursor: NetworkEffectCursor = {
    roomId: observation.roomId,
    version: observation.version,
    actionCount: observation.actionCount,
  }
  if (observation.forceRecovery) return recovery(cursor, observation.forceRecovery)
  if (!previous || previous.roomId !== observation.roomId) return recovery(cursor, 'initial-snapshot')
  if (observation.version <= previous.version) return { kind: 'drop', cursor: previous }
  if (observation.actionCount === 0 && previous.actionCount > 0) return recovery(cursor, 'round-reset')
  if (observation.version !== previous.version + 1) return recovery(cursor, 'version-gap')
  if (observation.actionCount < previous.actionCount || observation.actionCount > previous.actionCount + 1) {
    return recovery(cursor, 'action-gap')
  }
  return { kind: 'apply', cursor, sync: { mode: 'incremental' } }
}

/** Keeps duplicate renders from replaying an action or discarding a pending local flight origin. */
export const decideActionEffectSync = (previousActionCount: number | null, actionCount: number): ActionEffectSync => {
  if (previousActionCount === null) return 'baseline'
  if (actionCount === previousActionCount) return 'duplicate'
  if (actionCount === previousActionCount + 1) return 'play-next'
  return 'recovery'
}
