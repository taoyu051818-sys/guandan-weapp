export type HandInteractionBlockReason = 'pending' | 'trustee' | 'finished' | 'settlement'

export type HandInteractionState =
  | Readonly<{ mode: 'play' | 'tribute', blockReason: null }>
  | Readonly<{ mode: 'blocked', blockReason: HandInteractionBlockReason }>

export type HandInteractionMode = HandInteractionState['mode']

export type HandInteractionContext = Readonly<{
  phase: 'playing' | 'tribute' | 'settlement'
  actionPending: boolean
  trustee: boolean
  finished: boolean
}>

export const handInteractionContext = (input: Readonly<{
  phase: HandInteractionContext['phase']
  humanId: string
  actionPending: boolean
  trustee: boolean
  finishedPlayers: readonly string[]
}>): HandInteractionContext => ({
  phase: input.phase,
  actionPending: input.actionPending,
  trustee: input.trustee,
  // Tribute may still carry the previous round's finishing order.
  finished: input.phase === 'playing' && input.finishedPlayers.includes(input.humanId),
})

/** Pure projection: input availability has no independent lifecycle or lock-edit state. */
export const resolveHandInteraction = (context: HandInteractionContext): HandInteractionState => {
  if (context.actionPending) return { mode: 'blocked', blockReason: 'pending' }
  if (context.trustee) return { mode: 'blocked', blockReason: 'trustee' }
  if (context.finished) return { mode: 'blocked', blockReason: 'finished' }
  if (context.phase === 'settlement') return { mode: 'blocked', blockReason: 'settlement' }
  if (context.phase === 'tribute') return { mode: 'tribute', blockReason: null }
  return { mode: 'play', blockReason: null }
}
