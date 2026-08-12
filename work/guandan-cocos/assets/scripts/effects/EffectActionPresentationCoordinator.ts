import type { PlayAction, PlayerId } from '../core/generated'
import { decideActionEffectSync } from './NetworkEffectSyncPolicy'

export type PlayEffectPresentation = Readonly<{
  deferAction: (action: PlayAction, actionIndex: number) => string
  beginAction: (action: PlayAction, actionIndex: number, ticket: string) => void
  revealCard: (action: PlayAction, actionIndex: number, cardId: string, ticket: string) => void
  revealAction: (action: PlayAction, actionIndex: number, ticket: string) => void
  resetPresentation: (actionCount: number) => void
}>

export type EffectCardOrigin<TPosition> = Readonly<{
  cardId: string
  worldPosition: TPosition
}>

export type ActionEffectRequest<TPosition> = Readonly<{
  action: PlayAction
  actionIndex: number
  humanId: PlayerId
  sourcePositions: TPosition[]
  targetWorldPosition: TPosition
  onFlightStart?: () => void
  onCardArrive?: (cardId: string) => void
  onFlightFinish?: () => void
}>

type PositionProvider<TPosition> = (playerId: PlayerId) => TPosition

/** Owns action-count deduplication and the deferred table-card presentation ticket. */
export class EffectActionPresentationCoordinator<TPosition> {
  private lastActionCount: number | null = null
  private pendingLocalOrigins: readonly EffectCardOrigin<TPosition>[] = []
  private presentation: PlayEffectPresentation | null = null
  private pendingPresentationBaseline: number | null = null

  public captureLocalOrigins (origins: readonly EffectCardOrigin<TPosition>[]): void {
    this.pendingLocalOrigins = origins
  }

  /** Only one newly appended action may play; baselines and sequence gaps land silently. */
  public syncActions (
    actions: PlayAction[],
    humanId: PlayerId,
    source: PositionProvider<TPosition>,
    target: PositionProvider<TPosition>,
    presentation: PlayEffectPresentation | undefined,
    recover: () => void,
    play: (request: ActionEffectRequest<TPosition>) => void,
  ): void {
    if (presentation) this.presentation = presentation
    const activePresentation = presentation ?? this.presentation
    if (activePresentation && this.pendingPresentationBaseline !== null) {
      activePresentation.resetPresentation(this.pendingPresentationBaseline)
      this.pendingPresentationBaseline = null
    }
    const sync = decideActionEffectSync(this.lastActionCount, actions.length)
    if (sync !== 'play-next') {
      if (sync === 'recovery') recover()
      this.lastActionCount = actions.length
      // A duplicate render commonly occurs while a local network action is
      // pending. Keep its captured card origins until the authoritative append.
      if (sync !== 'duplicate') {
        this.pendingLocalOrigins = []
        activePresentation?.resetPresentation(actions.length)
      }
      return
    }
    const actionIndex = actions.length - 1
    const action = actions[actionIndex]
    this.lastActionCount = actions.length
    const fallback = source(action.playerId)
    const selected = action.playerId === humanId
      ? action.cards.map(card => this.pendingLocalOrigins.find(origin => origin.cardId === card.id)?.worldPosition ?? fallback)
      : action.cards.map(() => fallback)
    this.pendingLocalOrigins = []
    const ticket = activePresentation?.deferAction(action, actionIndex) ?? null
    play({
      action,
      actionIndex,
      humanId,
      sourcePositions: selected,
      targetWorldPosition: target(action.playerId),
      onFlightStart: () => { if (ticket) activePresentation?.beginAction(action, actionIndex, ticket) },
      onCardArrive: cardId => { if (ticket) activePresentation?.revealCard(action, actionIndex, cardId, ticket) },
      onFlightFinish: () => { if (ticket) activePresentation?.revealAction(action, actionIndex, ticket) },
    })
  }

  public resetForRecovery (actionCount: number): void {
    this.lastActionCount = actionCount
    if (this.presentation) {
      this.presentation.resetPresentation(actionCount)
      this.pendingPresentationBaseline = null
    } else {
      this.pendingPresentationBaseline = actionCount
    }
  }

  public clearPendingOrigins (): void {
    this.pendingLocalOrigins = []
  }
}
