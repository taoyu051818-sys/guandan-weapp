import type { Card, EngineState, MatchState, PlayerId } from '../core/generated'
import { HandWorkspace } from './HandWorkspace'
import { projectHandRenderModel, type HandRenderModel } from './HandRenderProjector'

export type TeammateHandView = Readonly<{ playerId: PlayerId, available: boolean }>
type Snapshot = Readonly<{
  state: EngineState & Partial<Pick<MatchState, 'roundId'>>
  phase: 'playing' | 'tribute' | 'settlement'
}>
const PLAYER_IDS: readonly PlayerId[] = ['p1', 'p2', 'p3', 'p4']
const visibleCard = (card: Card): boolean => Boolean(card && typeof card.id === 'string' && card.id &&
  ['spade', 'heart', 'club', 'diamond', 'joker'].includes(card.suit) &&
  [2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K', 'A', 'Small', 'Big'].includes(card.rank) &&
  Number.isFinite(card.value))

/** Presentation-only hand; never changes the authenticated seat or rule selection. */
export class TeammateHandProjector {
  private readonly workspace = new HandWorkspace()
  private owner: PlayerId | null = null

  public project (snapshot: Snapshot, humanId: PlayerId, direction: 'asc' | 'desc'):
    Readonly<{ view: TeammateHandView, hand: HandRenderModel }> | null {
    const { state } = snapshot
    const human = state.players[humanId]
    const teammates = PLAYER_IDS.filter(id => id !== humanId && state.players[id].team === human.team)
    const teammateId = teammates.length === 1 ? teammates[0] : null
    if (snapshot.phase !== 'playing' || !state.finishedPlayers.includes(humanId) || human.hand.length !== 0 ||
      !teammateId || state.finishedPlayers.includes(teammateId) || !state.players[teammateId].hand.length) {
      this.reset()
      return null
    }
    if (this.owner !== teammateId) this.reset()
    this.owner = teammateId
    const received = state.players[teammateId].hand
    // Old servers send count-only placeholders. Never invent faces or reuse cached private cards.
    const available = received.every(visibleCard)
    const hand = available ? received : []
    this.workspace.syncAuthoritativeHand(hand, {
      roundId: state.roundId ?? 0, levelRank: state.currentLevel, direction,
      autoSort: true, ruleProfile: state.ruleProfile,
    })
    return {
      view: { playerId: teammateId, available },
      hand: projectHandRenderModel({
        hand, mode: 'blocked', interactive: false, sortOrder: direction,
        grouping: this.workspace.snapshot, playSelectedCardIds: [], lockDraftCardIds: [],
        lockedCardIds: [], availableSuits: [], selectedSuit: null, lockAction: 'start',
        arrangeRestoreAvailable: false,
      }),
    }
  }

  public reset (): void { this.owner = null; this.workspace.resetForTableExit() }
}
