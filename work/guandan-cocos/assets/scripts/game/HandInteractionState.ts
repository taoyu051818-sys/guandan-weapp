export type HandInteractionMode =
  | 'play'
  | 'lock-create'
  | 'lock-unlock'
  | 'tribute'
  | 'blocked'

export type HandInteractionBlockReason = 'off-turn' | 'pending' | 'trustee' | 'finished' | 'settlement'

export type HandInteractionState = Readonly<{
  mode: HandInteractionMode
  blockReason: HandInteractionBlockReason | null
}>

export type HandInteractionContext = Readonly<{
  phase: 'playing' | 'tribute' | 'settlement'
  isCurrentTurn: boolean
  actionPending: boolean
  trustee: boolean
  finished: boolean
}>

export const handInteractionContext = (input: Readonly<{
  phase: HandInteractionContext['phase']
  currentTurn: string
  humanId: string
  actionPending: boolean
  trustee: boolean
  finishedPlayers: readonly string[]
}>): HandInteractionContext => ({
  phase: input.phase,
  isCurrentTurn: input.currentTurn === input.humanId,
  actionPending: input.actionPending,
  trustee: input.trustee,
  finished: input.finishedPlayers.includes(input.humanId),
})

const baseState = (context: HandInteractionContext): HandInteractionState => {
  if (context.actionPending) return { mode: 'blocked', blockReason: 'pending' }
  if (context.trustee) return { mode: 'blocked', blockReason: 'trustee' }
  if (context.finished) return { mode: 'blocked', blockReason: 'finished' }
  if (context.phase === 'settlement') return { mode: 'blocked', blockReason: 'settlement' }
  if (context.phase === 'tribute') return { mode: 'tribute', blockReason: null }
  return context.isCurrentTurn
    ? { mode: 'play', blockReason: null }
    : { mode: 'blocked', blockReason: 'off-turn' }
}

/** Owns the exclusive input mode; card selections stay in their mode-specific stores. */
export class HandInteractionStateMachine {
  private current: HandInteractionState = { mode: 'blocked', blockReason: 'settlement' }
  private context: HandInteractionContext | null = null

  public get state (): HandInteractionState { return this.current }
  public get isLocking (): boolean { return this.current.mode === 'lock-create' || this.current.mode === 'lock-unlock' }

  public sync (context: HandInteractionContext): HandInteractionState {
    this.context = context
    const fallback = baseState(context)
    const lockStillAllowed = this.isLocking && context.phase === 'playing' &&
      !context.actionPending && !context.trustee && !context.finished
    this.current = lockStillAllowed ? this.current : fallback
    return this.current
  }

  /** Locking is explicit and is allowed off-turn, but never during an in-flight action. */
  public startLock (): boolean {
    if (!this.context || this.context.phase !== 'playing' || this.context.actionPending ||
      this.context.trustee || this.context.finished) return false
    this.current = { mode: 'lock-create', blockReason: null }
    return true
  }

  public selectUnlock (): void {
    if (this.isLocking) this.current = { mode: 'lock-unlock', blockReason: null }
  }

  public selectLockCreate (): void {
    if (this.isLocking) this.current = { mode: 'lock-create', blockReason: null }
  }

  public finishLock (): HandInteractionState {
    this.current = this.context ? baseState(this.context) : { mode: 'blocked', blockReason: 'settlement' }
    return this.current
  }

  public reset (): void {
    this.context = null
    this.current = { mode: 'blocked', blockReason: 'settlement' }
  }
}
