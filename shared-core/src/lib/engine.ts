import { createDeck, dealCards, shuffleDeck } from './deck'
import { getRuleProfile, resolvePlayForContext, type RuleProfile } from './rules'
import { cloneSettlementResult, settleMatchState, type SettlementResult } from './settlement'
import {
  executeTributeCommand,
  prepareNextRound,
  type MatchTributeState,
  type MatchTributeStatus,
  type TributeMode,
} from './tribute'
import {
  advanceAfterPlay,
  nextActivePlayer,
  passAndAdvance,
  recordPlay,
  teammateOf,
} from './turn'
import { PlayType } from '../types/game'
import type { MatchFormat } from './matchFormat'
import type {
  Card,
  PlayAction,
  Player,
  PlayerId,
  Rank,
  RoundMeta,
  Team,
} from '../types/game'

export interface EngineState {
  matchFormat?: MatchFormat
  playerScores?: Record<PlayerId, number>
  pairingCard?: Pick<Card, 'suit' | 'rank'>
  currentLevel: Rank
  ruleProfile: RuleProfile
  players: Record<PlayerId, Player>
  turnOrder: PlayerId[]
  currentTurn: PlayerId
  playArea: PlayAction[]
  lastValidPlay: PlayAction | null
  finishedPlayers: PlayerId[]
}

export interface TrickState {
  winningPlay: PlayAction | null
  passedPlayerIds: PlayerId[]
}

export type MatchPhase = 'playing' | 'tribute' | 'settled'

export interface MatchState extends EngineState {
  revision: number
  roundId: number
  phase: MatchPhase
  levelTeam: Team
  teamLevels: Record<Team, Rank>
  aFailStreaks: Record<Team, number>
  dealerId: PlayerId
  trick: TrickState
  playHistory: PlayAction[]
  lastRoundRank: PlayerId[]
  scores: Record<Team, number>
  settlement: SettlementResult | null
  tribute: MatchTributeState | null
  roundMeta: RoundMeta | null
}

export interface CreateMatchStateInput {
  matchFormat?: MatchFormat
  ruleProfile: RuleProfile
  currentLevel: Rank
  levelTeam: Team
  teamLevels: Record<Team, Rank>
  dealerId: PlayerId
  players: Record<PlayerId, Player>
  turnOrder?: PlayerId[]
  currentTurn?: PlayerId
  aFailStreaks?: Record<Team, number>
  scores?: Record<Team, number>
  lastRoundRank?: PlayerId[]
  roundId?: number
  revision?: number
  roundMeta?: RoundMeta | null
}

interface VersionedCommand {
  roundId: number
  expectedRevision: number
}

export interface PlayCardsCommand extends VersionedCommand {
  type: 'PLAY_CARDS'
  playerId: PlayerId
  cardIds: string[]
}

export interface PassCommand extends VersionedCommand {
  type: 'PASS'
  playerId: PlayerId
}

export interface PrepareNextRoundCommand extends VersionedCommand {
  type: 'PREPARE_NEXT_ROUND'
  dealtHands: Record<PlayerId, Card[]>
  nextLevel?: Rank
  pairingIndex?: number
}

export interface SelectTributeCardCommand extends VersionedCommand {
  type: 'SELECT_TRIBUTE_CARD'
  playerId: PlayerId
  cardId: string
}

export interface SelectReturnCardCommand extends VersionedCommand {
  type: 'SELECT_RETURN_CARD'
  playerId: PlayerId
  cardId: string
}

export interface BeginPlayAfterTributeCommand extends VersionedCommand {
  type: 'BEGIN_PLAY_AFTER_TRIBUTE'
  playerId: PlayerId
}

export type GameCommand =
  | PlayCardsCommand
  | PassCommand
  | PrepareNextRoundCommand
  | SelectTributeCardCommand
  | SelectReturnCardCommand
  | BeginPlayAfterTributeCommand

export type GameEvent =
  | { type: 'CARDS_PLAYED'; action: PlayAction }
  | { type: 'PLAYER_PASSED'; playerId: PlayerId }
  | { type: 'PLAYER_FINISHED'; playerId: PlayerId; place: number }
  | { type: 'TURN_ADVANCED'; fromPlayerId: PlayerId; toPlayerId: PlayerId }
  | { type: 'TRICK_COMPLETED'; winnerId: PlayerId; nextLeaderId: PlayerId; isContact: boolean }
  | { type: 'ROUND_SETTLED'; settlement: SettlementResult }
  | { type: 'ROUND_PREPARED'; roundId: number; mode: TributeMode; status: MatchTributeStatus }
  | { type: 'ANTI_TRIBUTE_DECLARED'; mode: TributeMode }
  | { type: 'TRIBUTE_CARD_SELECTED'; playerId: PlayerId }
  | { type: 'TRIBUTE_TRANSFERRED'; fromPlayerId: PlayerId; toPlayerId: PlayerId; cardId: string }
  | { type: 'RETURN_CARD_SELECTED'; playerId: PlayerId }
  | { type: 'RETURN_TRANSFERRED'; fromPlayerId: PlayerId; toPlayerId: PlayerId; cardId: string }
  | { type: 'TRIBUTE_READY'; mode: TributeMode }
  | { type: 'PLAY_STARTED_AFTER_TRIBUTE'; leaderId: PlayerId; wasResisted: boolean }

export type TransitionResult =
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; reason: string }

const ids: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
const teamFor = (id: PlayerId): Team => id === 'p1' || id === 'p3' ? 'teamA' : 'teamB'
const player = (id: PlayerId, hand: Card[] = []): Player => ({
  id,
  name: id === 'p1' ? '玩家' : `电脑${id.slice(1)}`,
  isAI: id !== 'p1',
  team: teamFor(id),
  hand,
  role: 'normal',
})

const clonePlayers = (players: Record<PlayerId, Player>): Record<PlayerId, Player> => ({
  p1: { ...players.p1, hand: [...players.p1.hand] },
  p2: { ...players.p2, hand: [...players.p2.hand] },
  p3: { ...players.p3, hand: [...players.p3.hand] },
  p4: { ...players.p4, hand: [...players.p4.hand] },
})

/** Legacy fixture/server constructor; new match entry points must pass an explicit profile. */
export const createGame = (
  level: Rank = 2,
  dealer: PlayerId = 'p1',
  ruleProfile: RuleProfile = getRuleProfile('classic'),
  random: () => number = Math.random,
): EngineState => {
  const hands = dealCards(shuffleDeck(createDeck(level), random))
  const players = ids.reduce((all, id) => ({
    ...all,
    [id]: player(id, hands[id].sort((a, b) => b.value - a.value)),
  }), {} as Record<PlayerId, Player>)
  return {
    currentLevel: level,
    ruleProfile,
    players,
    turnOrder: [...ids],
    currentTurn: dealer,
    playArea: [],
    lastValidPlay: null,
    finishedPlayers: [],
  }
}

export const createMatchState = (input: CreateMatchStateInput): MatchState => ({
  ...(input.matchFormat ? { matchFormat: { ...input.matchFormat } } : {}),
  revision: input.revision ?? 0,
  roundId: input.roundId ?? 1,
  phase: 'playing',
  ruleProfile: input.ruleProfile,
  currentLevel: input.currentLevel,
  levelTeam: input.levelTeam,
  teamLevels: { ...input.teamLevels },
  aFailStreaks: input.aFailStreaks ? { ...input.aFailStreaks } : { teamA: 0, teamB: 0 },
  dealerId: input.dealerId,
  players: clonePlayers(input.players),
  turnOrder: [...(input.turnOrder ?? ids)],
  currentTurn: input.currentTurn ?? input.dealerId,
  trick: { winningPlay: null, passedPlayerIds: [] },
  playArea: [],
  playHistory: [],
  lastValidPlay: null,
  finishedPlayers: [],
  lastRoundRank: [...(input.lastRoundRank ?? [])],
  scores: input.scores ? { ...input.scores } : { teamA: 0, teamB: 0 },
  settlement: null,
  tribute: null,
  roundMeta: input.roundMeta ? { ...input.roundMeta } : null,
})

/** Two teammates taking the first two places ends the round; otherwise third place does. */
export const isRoundOver = (state: EngineState): boolean => {
  if (state.finishedPlayers.length >= 3) return true
  if (state.matchFormat?.kind === 'independent' && state.matchFormat.individualRanking) return false
  if (state.finishedPlayers.length < 2) return false
  const [first, second] = state.finishedPlayers
  return state.players[first].team === state.players[second].team
}

export const fullRoundRank = (state: EngineState): PlayerId[] => [
  ...state.finishedPlayers,
  ...ids.filter(id => !state.finishedPlayers.includes(id)),
]

export const dealNextRound = (previous: EngineState, level: Rank, dealer: PlayerId): EngineState => {
  const hands = dealCards(shuffleDeck(createDeck(level)))
  const players = ids.reduce((all, id) => ({
    ...all,
    [id]: {
      ...previous.players[id],
      hand: [...hands[id]].sort((a, b) => b.value - a.value),
      role: 'normal' as const,
    },
  }), {} as Record<PlayerId, Player>)
  return {
    currentLevel: level,
    ruleProfile: previous.ruleProfile,
    players,
    turnOrder: [...previous.turnOrder],
    currentTurn: dealer,
    playArea: [],
    lastValidPlay: null,
    finishedPlayers: [],
  }
}

const ownedCards = (
  state: EngineState,
  playerId: PlayerId,
  cardIds: readonly string[],
): Card[] | null => {
  const handById = new Map(state.players[playerId].hand.map(card => [card.id, card]))
  const cards = cardIds.map(cardId => handById.get(cardId))
  return cards.every((card): card is Card => card !== undefined) ? cards : null
}

const legacyAdvance = (state: EngineState): EngineState => {
  if (isRoundOver(state)) return state
  const last = state.lastValidPlay
  if (!last) {
    const next = nextActivePlayer(state, state.currentTurn)
    return next ? { ...state, currentTurn: next } : state
  }
  const lastIndex = state.playArea.map(action => action === last).lastIndexOf(true)
  const passes = state.playArea.slice(lastIndex + 1).filter(action => action.type === PlayType.Pass).length
  const alive = ids.filter(id => state.players[id].hand.length > 0)
  const required = alive.length - (state.players[last.playerId].hand.length > 0 ? 1 : 0)
  if (passes < required) {
    const next = nextActivePlayer(state, state.currentTurn)
    return next ? { ...state, currentTurn: next } : state
  }
  const teammate = teammateOf(state, last.playerId)
  const leader = state.players[last.playerId].hand.length > 0
    ? last.playerId
    : teammate && state.players[teammate].hand.length > 0
      ? teammate
      : nextActivePlayer(state, state.currentTurn)
  return leader ? { ...state, currentTurn: leader, lastValidPlay: null } : state
}

/** Compatibility facade. New application and server code should dispatch through transition. */
export const playCards = (state: EngineState, playerId: PlayerId, cards: Card[]): EngineState => {
  if (state.currentTurn !== playerId) throw new Error('未轮到该玩家出牌')
  if (cards.length === 0 || new Set(cards.map(card => card.id)).size !== cards.length) {
    throw new Error('不合法的出牌')
  }
  const canonicalCards = ownedCards(state, playerId, cards.map(card => card.id))
  if (!canonicalCards) throw new Error('出牌不属于当前玩家手牌')
  const resolution = resolvePlayForContext(canonicalCards, state.lastValidPlay, state.ruleProfile)
  if (!resolution) {
    throw new Error('不合法的出牌')
  }
  const action: PlayAction = { playerId, cards: canonicalCards, type: resolution.type, resolution }
  const playedIds = new Set(canonicalCards.map(card => card.id))
  const hand = state.players[playerId].hand.filter(card => !playedIds.has(card.id))
  const finishedPlayers = hand.length === 0 && !state.finishedPlayers.includes(playerId)
    ? [...state.finishedPlayers, playerId]
    : state.finishedPlayers
  return legacyAdvance({
    ...state,
    players: { ...state.players, [playerId]: { ...state.players[playerId], hand } },
    playArea: [...state.playArea, action],
    lastValidPlay: action,
    finishedPlayers,
  })
}

export const passTurn = (state: EngineState, playerId: PlayerId): EngineState => {
  if (state.currentTurn !== playerId || !state.lastValidPlay) throw new Error('当前不能过牌')
  return legacyAdvance({
    ...state,
    playArea: [...state.playArea, { playerId, cards: [], type: PlayType.Pass }],
  })
}

const failure = (reason: string): TransitionResult => ({ ok: false, reason })

const commit = (previous: MatchState, state: MatchState, events: GameEvent[]): TransitionResult => ({
  ok: true,
  state: { ...state, revision: previous.revision + 1 },
  events,
})

const validateEnvelope = (state: MatchState, command: GameCommand): string | null => {
  if (command.roundId !== state.roundId) return 'ROUND_MISMATCH'
  if (command.expectedRevision !== state.revision) return 'STALE_REVISION'
  return null
}

const validatePlayingActor = (
  state: MatchState,
  command: PlayCardsCommand | PassCommand,
): string | null => {
  if (state.phase !== 'playing') return 'MATCH_NOT_PLAYING'
  if (command.playerId !== state.currentTurn) return 'NOT_PLAYER_TURN'
  if (state.players[command.playerId].hand.length === 0) return 'PLAYER_ALREADY_FINISHED'
  return null
}

const transitionPlay = (state: MatchState, command: PlayCardsCommand): TransitionResult => {
  if (command.cardIds.length === 0) return failure('EMPTY_PLAY')
  if (new Set(command.cardIds).size !== command.cardIds.length) return failure('DUPLICATE_CARD')
  const cards = ownedCards(state, command.playerId, command.cardIds)
  if (!cards) return failure('CARD_NOT_IN_HAND')
  const resolution = resolvePlayForContext(cards, state.trick.winningPlay, state.ruleProfile)
  if (!resolution) {
    return failure('ILLEGAL_PLAY')
  }

  const played = recordPlay(state, command.playerId, cards, resolution)
  if (isRoundOver(played.state)) {
    const settled = settleMatchState(played.state)
    if (!settled) return failure('SETTLEMENT_UNAVAILABLE')
    return commit(state, settled.state, [
      ...played.events,
      { type: 'ROUND_SETTLED', settlement: cloneSettlementResult(settled.settlement) },
    ])
  }
  const advanced = advanceAfterPlay(played.state, command.playerId)
  if (!advanced.ok) return failure(advanced.reason)
  return commit(state, advanced.result.state, [...played.events, ...advanced.result.events])
}

const transitionPass = (state: MatchState, command: PassCommand): TransitionResult => {
  const winningPlay = state.trick.winningPlay
  if (!winningPlay) return failure('CANNOT_PASS_ON_LEAD')
  if (winningPlay.playerId === command.playerId) return failure('WINNING_PLAYER_CANNOT_PASS')
  if (state.trick.passedPlayerIds.includes(command.playerId)) return failure('PLAYER_ALREADY_PASSED')

  const passed = passAndAdvance(state, command.playerId)
  return passed.ok
    ? commit(state, passed.result.state, passed.result.events)
    : failure(passed.reason)
}

export const transition = (state: MatchState, command: GameCommand): TransitionResult => {
  const envelopeError = validateEnvelope(state, command)
  if (envelopeError) return failure(envelopeError)
  switch (command.type) {
    case 'PLAY_CARDS': {
      const actorError = validatePlayingActor(state, command)
      return actorError ? failure(actorError) : transitionPlay(state, command)
    }
    case 'PASS': {
      const actorError = validatePlayingActor(state, command)
      return actorError ? failure(actorError) : transitionPass(state, command)
    }
    case 'PREPARE_NEXT_ROUND':
      {
        const result = prepareNextRound(state, command)
        return result.ok ? commit(state, result.state, result.events) : failure(result.reason)
      }
    case 'SELECT_TRIBUTE_CARD':
    case 'SELECT_RETURN_CARD':
    case 'BEGIN_PLAY_AFTER_TRIBUTE':
      {
        const result = executeTributeCommand(state, command)
        return result.ok ? commit(state, result.state, result.events) : failure(result.reason)
      }
  }
}
