import {
  automaticReturnCard,
  createDeck,
  createGame,
  createMatchState,
  dealCards,
  diagnosePlay,
  highestCard,
  legalMoves,
  shuffleDeck,
  transition,
} from '../core/generated'
import type {
  BeginPlayAfterTributeCommand,
  AIContext,
  Card,
  EngineState,
  GameCommand,
  GameEvent,
  MatchState,
  PassCommand,
  PlayerId,
  PlayCardsCommand,
  PrepareNextRoundCommand,
  Rank,
  RuleProfile,
  SelectReturnCardCommand,
  SelectTributeCardCommand,
  SettlementResult,
  Team,
  TransitionResult,
  TributeState,
} from '../core/generated'
import type { Difficulty } from '../core/generated/lib/ai'

export type LocalMatchVersion = Readonly<{ roundId: number, revision: number }>

export const localMatchFailureHint = (reason: string): string => {
  const messages: Readonly<Record<string, string>> = {
    ROUND_MISMATCH: '牌局已更新，请重新操作',
    STALE_REVISION: '牌局状态已更新，请重新操作',
    NOT_PLAYER_TURN: '未轮到该玩家操作',
    EMPTY_PLAY: '请选择手牌',
    DUPLICATE_CARD: '不能重复选择同一张牌',
    CARD_NOT_IN_HAND: '手牌已更新，请重新选择',
    ILLEGAL_PLAY: '牌型不合法或压不过上家',
    CANNOT_PASS_ON_LEAD: '当前不能不要',
    INELIGIBLE_TRIBUTE_CARD: '进贡必须交出当前最大的牌',
    INELIGIBLE_RETURN_CARD: '还贡牌不符合规则',
  }
  return messages[reason] ?? `牌局操作失败：${reason}`
}

export type LocalMatchIntent =
  | Omit<PlayCardsCommand, 'roundId' | 'expectedRevision'>
  | Omit<PassCommand, 'roundId' | 'expectedRevision'>
  | Omit<PrepareNextRoundCommand, 'roundId' | 'expectedRevision'>
  | Omit<SelectTributeCardCommand, 'roundId' | 'expectedRevision'>
  | Omit<SelectReturnCardCommand, 'roundId' | 'expectedRevision'>
  | Omit<BeginPlayAfterTributeCommand, 'roundId' | 'expectedRevision'>

export type LocalMatchProjection = Readonly<{
  state: MatchState
  phase: 'playing' | 'tribute' | 'settlement'
  teamLevels: Record<Team, Rank>
  aFailStreaks: Record<Team, number>
  scores: Record<Team, number>
  lastRoundRank: PlayerId[]
  tribute: TributeState | null
  settlement: SettlementResult | null
}>

export type LocalMatchOperationResult =
  | { ok: true, state: MatchState, events: GameEvent[] }
  | { ok: false, reason: string }

export type LocalMatchStartOptions = Readonly<{
  level: Rank
  dealerId: PlayerId
  levelTeam?: Team
  teamLevels: Record<Team, Rank>
  ruleProfile: RuleProfile
  random?: () => number
}>

export interface LocalAIEngine {
  makeDecision: (
    hand: Card[],
    lastPlay: MatchState['lastValidPlay'],
    difficulty: Difficulty,
    myTeam: Team,
    players: MatchState['players'],
    playerId?: PlayerId,
    context?: AIContext,
  ) => Card[] | null
  reset?: () => void
  dispose?: () => void
}

/** Pure application controller for one local match. It is the sole MatchState writer. */
export class LocalMatchController {
  private constructor (private match: MatchState, private readonly random: () => number = Math.random) {}

  public static start (options: LocalMatchStartOptions): LocalMatchController {
    const random = options.random ?? Math.random
    const game = createGame(options.level, options.dealerId, options.ruleProfile, random)
    return new LocalMatchController(createMatchState({
      ruleProfile: options.ruleProfile,
      currentLevel: options.level,
      levelTeam: options.levelTeam ?? 'teamA',
      teamLevels: options.teamLevels,
      dealerId: options.dealerId,
      players: game.players,
      turnOrder: game.turnOrder,
      currentTurn: game.currentTurn,
    }), random)
  }

  public static fromEngineState (
    state: EngineState,
    teamLevels: Record<Team, Rank>,
    random: () => number = Math.random,
  ): LocalMatchController {
    const base = createMatchState({
      ruleProfile: state.ruleProfile,
      currentLevel: state.currentLevel,
      levelTeam: 'teamA',
      teamLevels,
      dealerId: state.currentTurn,
      players: state.players,
      turnOrder: state.turnOrder,
      currentTurn: state.currentTurn,
    })
    return new LocalMatchController({
      ...base,
      playArea: [...state.playArea],
      playHistory: [...state.playArea],
      lastValidPlay: state.lastValidPlay,
      trick: { winningPlay: state.lastValidPlay, passedPlayerIds: [] },
      finishedPlayers: [...state.finishedPlayers],
    }, random)
  }

  public get state (): MatchState { return this.match }
  public get ruleProfile (): RuleProfile { return this.match.ruleProfile }
  public get version (): LocalMatchVersion { return { roundId: this.match.roundId, revision: this.match.revision } }

  public isCurrent (version: LocalMatchVersion): boolean {
    return version.roundId === this.match.roundId && version.revision === this.match.revision
  }

  public get projection (): LocalMatchProjection {
    return {
      state: this.match,
      phase: this.match.phase === 'settled' ? 'settlement' : this.match.phase,
      teamLevels: { ...this.match.teamLevels },
      aFailStreaks: { ...this.match.aFailStreaks },
      scores: { ...this.match.scores },
      lastRoundRank: [...this.match.lastRoundRank],
      tribute: this.projectLegacyTribute(),
      settlement: this.match.settlement,
    }
  }

  public dispatch (intent: LocalMatchIntent): TransitionResult {
    const result = transition(this.match, {
      ...intent,
      roundId: this.match.roundId,
      expectedRevision: this.match.revision,
    } as GameCommand)
    if (result.ok) this.match = result.state
    return result
  }

  public prepareNextRound (): TransitionResult {
    if (!this.match.settlement) return { ok: false, reason: 'SETTLEMENT_UNAVAILABLE' }
    return this.dispatch({
      type: 'PREPARE_NEXT_ROUND',
      dealtHands: dealCards(shuffleDeck(createDeck(this.match.settlement.currentLevel), this.random)),
    })
  }

  public runAiTurn (playerId: PlayerId, difficulty: Difficulty, aiEngine?: LocalAIEngine): TransitionResult {
    if (this.match.phase !== 'playing') return { ok: false, reason: 'MATCH_NOT_PLAYING' }
    if (this.match.currentTurn !== playerId) return { ok: false, reason: 'NOT_PLAYER_TURN' }
    const player = this.match.players[playerId]
    const decision = aiEngine?.makeDecision(
      player.hand,
      this.match.lastValidPlay,
      difficulty,
      player.team,
      this.match.players,
      playerId,
      {
        ruleProfile: this.match.ruleProfile,
        currentLevel: this.match.currentLevel,
        teamLevels: this.match.teamLevels,
        roundMeta: this.match.roundMeta,
      },
    )
    if (decision?.length && diagnosePlay(decision, this.match.lastValidPlay, this.match.ruleProfile).canPlay) {
      return this.dispatch({ type: 'PLAY_CARDS', playerId, cardIds: decision.map(card => card.id) })
    }
    if (aiEngine && decision === null && this.match.lastValidPlay) return this.dispatch({ type: 'PASS', playerId })
    const fallback = legalMoves(player.hand, this.match.lastValidPlay, this.match.ruleProfile)[0]
    if (fallback?.length) return this.dispatch({ type: 'PLAY_CARDS', playerId, cardIds: fallback.map(card => card.id) })
    return this.match.lastValidPlay
      ? this.dispatch({ type: 'PASS', playerId })
      : { ok: false, reason: 'AI_NO_LEGAL_LEAD' }
  }

  public automateTribute (): LocalMatchOperationResult {
    const events: GameEvent[] = []
    while (this.match.tribute?.status === 'selecting_tribute') {
      const exchange = this.match.tribute.exchanges.find(item => this.match.players[item.from].isAI && !item.tributeCardId)
      if (!exchange) break
      const hand = this.match.players[exchange.from].hand
      const eligible = hand.filter(card => !(card.isLevelCard && card.suit === 'heart'))
      const card = highestCard(eligible.length ? eligible : hand)
      if (!card) return { ok: false, reason: 'AI_NO_TRIBUTE_CARD' }
      const result = this.dispatch({ type: 'SELECT_TRIBUTE_CARD', playerId: exchange.from, cardId: card.id })
      if (!result.ok) return result
      events.push(...result.events)
    }
    while (this.match.tribute?.status === 'selecting_return') {
      const exchange = this.match.tribute.exchanges.find(item => this.match.players[item.to].isAI && !item.returnCardId)
      if (!exchange) break
      const card = automaticReturnCard(this.match.players[exchange.to].hand)
      if (!card) return { ok: false, reason: 'AI_NO_RETURN_CARD' }
      const result = this.dispatch({ type: 'SELECT_RETURN_CARD', playerId: exchange.to, cardId: card.id })
      if (!result.ok) return result
      events.push(...result.events)
    }
    return { ok: true, state: this.match, events }
  }

  public beginPlayAfterTribute (): TransitionResult {
    const playerId = this.tributeLeader()
    return playerId
      ? this.dispatch({ type: 'BEGIN_PLAY_AFTER_TRIBUTE', playerId })
      : { ok: false, reason: 'TRIBUTE_LEADER_NOT_FOUND' }
  }

  private tributeLeader (): PlayerId | null {
    const tribute = this.match.tribute
    if (!tribute) return null
    if (tribute.status === 'resisted') return this.match.dealerId
    const first = this.match.lastRoundRank[0]
    return tribute.exchanges.find(exchange => exchange.to === first)?.from ?? null
  }

  private projectLegacyTribute (): TributeState | null {
    const tribute = this.match.tribute
    if (!tribute) return null
    const findCard = (cardId: string | null): Card | null => {
      if (!cardId) return null
      for (const playerId of this.match.turnOrder) {
        const card = this.match.players[playerId].hand.find(candidate => candidate.id === cardId)
        if (card) return card
      }
      return null
    }
    return {
      isDoubleDown: tribute.mode === 'double',
      isAntiTribute: tribute.status === 'resisted',
      phase: tribute.status === 'selecting_tribute'
        ? 'tributing'
        : tribute.status === 'selecting_return'
          ? 'returning'
          : 'done',
      actions: tribute.exchanges.map(exchange => ({
        from: exchange.from,
        to: exchange.to,
        card: findCard(exchange.tributeCardId),
        returnCard: findCard(exchange.returnCardId),
      })),
    }
  }
}
