import { canPlay, enumerateCandidateMoves, type EngineState, type PlayerId } from '../core/generated'

export type TablePlayActionKey = 'hint' | 'pass' | 'play'

/** Queries the existing rules, never the selected cards or presentation locks. */
export class TablePlayActionPolicy {
  private key = ''
  private responseAvailable = false

  public resolve (state: EngineState, playerId: PlayerId): readonly TablePlayActionKey[] {
    const hand = state.players[playerId].hand
    if (!hand.length) return []
    if (!state.lastValidPlay || state.lastValidPlay.type === 'Pass') return ['hint', 'play']
    // Selection/clock refreshes reuse this result. Include card semantics, not
    // just IDs: a level or wildcard change may reuse the same physical deck.
    const key = JSON.stringify([hand, state.lastValidPlay, state.ruleProfile])
    if (key !== this.key) {
      this.responseAvailable = enumerateCandidateMoves(hand).some(cards => canPlay(cards, state.lastValidPlay, state.ruleProfile))
      this.key = key
    }
    return this.responseAvailable ? ['hint', 'pass', 'play'] : ['pass']
  }
}
