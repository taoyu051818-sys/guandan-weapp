import type { EngineState, MatchState, PlayerId } from '../core/generated'

/** Input lifetime follows authoritative selection invalidation, not render frequency. */
export class HandGestureEpoch {
  private epoch = 0
  private previous: { scope: string, phase: string, roundId: number | undefined, hand: string, ownTurn: boolean } | null = null

  public update (state: Readonly<EngineState>, humanId: PlayerId, phase: string, scope: string): number {
    const next = { scope, phase, roundId: (state as Partial<MatchState>).roundId,
      hand: JSON.stringify((state.players[humanId]?.hand ?? []).map(card => card.id).sort()),
      ownTurn: state.currentTurn === humanId }
    const previous = this.previous
    if (!previous || next.scope !== previous.scope || next.phase !== previous.phase || next.roundId !== previous.roundId ||
      next.hand !== previous.hand || (previous.ownTurn && !next.ownTurn)) this.epoch += 1
    this.previous = next
    return this.epoch
  }
}
