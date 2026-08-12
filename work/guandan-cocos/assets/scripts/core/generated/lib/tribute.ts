import type { Card, PlayerId } from '../types/game'
import { createDeck } from './deck'
import type {
  BeginPlayAfterTributeCommand,
  GameEvent,
  MatchState,
  PrepareNextRoundCommand,
  SelectReturnCardCommand,
  SelectTributeCardCommand,
} from './engine'

const ids: PlayerId[] = ['p1','p2','p3','p4']
export const highestCard = (cards: Card[]) => [...cards].sort((a,b) => b.value-a.value)[0]
export const lowestCard = (cards: Card[]) => [...cards].sort((a,b) => a.value-b.value)[0]
/** 服务端托管还贡：优先选 <=10 的最低牌；无低牌时按竞赛规则选整手最低。 */
export const automaticReturnCard = (cards: Card[]): Card | undefined => {
  const eligible = cards.filter(card => card.value <= 10)
  return lowestCard(eligible.length ? eligible : cards)
}

export type TributeMode = 'single' | 'double'
export type MatchTributeStatus = 'selecting_tribute' | 'selecting_return' | 'ready' | 'resisted'

export interface TributeExchange {
  id: string
  from: PlayerId
  to: PlayerId
  tributeCardId: string | null
  returnCardId: string | null
}

/** Selection ids are authoritative but private; network projections must omit them for other seats. */
export interface MatchTributeState {
  mode: TributeMode
  status: MatchTributeStatus
  exchanges: TributeExchange[]
}

export type TributeOperationResult =
  | { ok: true; state: MatchState; events: GameEvent[] }
  | { ok: false; reason: string }

const failure = (reason: string): TributeOperationResult => ({ ok: false, reason })

const canonicalCardMatches = (actual: Card, expected: Card): boolean =>
  actual.id === expected.id
  && actual.suit === expected.suit
  && actual.rank === expected.rank
  && actual.value === expected.value
  && actual.isLevelCard === expected.isLevelCard
  && Boolean(actual.isRedJoker) === Boolean(expected.isRedJoker)

const validateCanonicalHands = (
  hands: Record<PlayerId, Card[]>,
  currentLevel: MatchState['currentLevel'],
): string | null => {
  if (ids.some(id => !Array.isArray(hands[id]) || hands[id].length !== 27)) {
    return 'INVALID_DEALT_HANDS'
  }
  const cards = ids.flatMap(id => hands[id])
  if (new Set(cards.map(card => card.id)).size !== 108) return 'DUPLICATE_DEALT_CARD'
  const canonicalById = new Map(createDeck(currentLevel).map(card => [card.id, card]))
  if (cards.some(card => {
    const canonical = canonicalById.get(card.id)
    return !canonical || !canonicalCardMatches(card, canonical)
  })) return 'INVALID_DEALT_CARD'
  return null
}

const makeExchanges = (
  mode: TributeMode,
  rank: PlayerId[],
  roundId: number,
): TributeExchange[] => {
  const [first, second, third, last] = rank
  if (mode === 'single') {
    return [{
      id: `${roundId}:${last}:${first}`,
      from: last,
      to: first,
      tributeCardId: null,
      returnCardId: null,
    }]
  }
  return [
    {
      id: `${roundId}:${third}:${first}`,
      from: third,
      to: first,
      tributeCardId: null,
      returnCardId: null,
    },
    {
      id: `${roundId}:${last}:${second}`,
      from: last,
      to: second,
      tributeCardId: null,
      returnCardId: null,
    },
  ]
}

const hasAntiTribute = (
  mode: TributeMode,
  exchanges: TributeExchange[],
  hands: Record<PlayerId, Card[]>,
): boolean => {
  const jokers = exchanges.flatMap(exchange => hands[exchange.from])
    .filter(card => card.suit === 'joker')
  return mode === 'single'
    ? jokers.length >= 2
    : jokers.length >= 4 || jokers.filter(card => card.rank === 'Big').length >= 2
}

export const prepareNextRound = (
  state: MatchState,
  command: PrepareNextRoundCommand,
): TributeOperationResult => {
  if (state.phase !== 'settled' || !state.settlement) return failure('MATCH_NOT_SETTLED')
  if (state.settlement.isGameWon) return failure('MATCH_ALREADY_WON')
  const handsError = validateCanonicalHands(command.dealtHands, state.settlement.currentLevel)
  if (handsError) return failure(handsError)
  if (state.lastRoundRank.length !== 4) return failure('ROUND_RANK_UNAVAILABLE')
  const [first, second] = state.lastRoundRank
  const mode: TributeMode = state.players[first].team === state.players[second].team
    ? 'double'
    : 'single'
  const roundId = state.roundId + 1
  const exchanges = makeExchanges(mode, state.lastRoundRank, roundId)
  const resisted = hasAntiTribute(mode, exchanges, command.dealtHands)
  const tribute: MatchTributeState = {
    mode,
    status: resisted ? 'resisted' : 'selecting_tribute',
    exchanges,
  }
  const dealerId = state.lastRoundRank[0]
  const players = cloneMatchPlayers(state)
  ids.forEach(id => {
    players[id] = {
      ...players[id],
      hand: command.dealtHands[id].map(card => ({ ...card })),
      role: 'normal',
    }
  })
  return {
    ok: true,
    state: {
      ...state,
      roundId,
      phase: 'tribute',
      currentLevel: state.settlement.currentLevel,
      dealerId,
      players,
      currentTurn: dealerId,
      trick: { winningPlay: null, passedPlayerIds: [] },
      playArea: [],
      playHistory: [],
      lastValidPlay: null,
      finishedPlayers: [],
      settlement: null,
      tribute,
      roundMeta: { fromTribute: true, isAntiTribute: resisted },
    },
    events: [
      { type: 'ROUND_PREPARED', roundId, mode, status: tribute.status },
      ...(resisted ? [{ type: 'ANTI_TRIBUTE_DECLARED' as const, mode }] : []),
    ],
  }
}

const cloneMatchPlayers = (state: MatchState): MatchState['players'] => ({
  p1: { ...state.players.p1, hand: [...state.players.p1.hand] },
  p2: { ...state.players.p2, hand: [...state.players.p2.hand] },
  p3: { ...state.players.p3, hand: [...state.players.p3.hand] },
  p4: { ...state.players.p4, hand: [...state.players.p4.hand] },
})

const selectedCard = (
  state: MatchState,
  playerId: PlayerId,
  cardId: string | null,
): Card | null => cardId
  ? state.players[playerId].hand.find(card => card.id === cardId) ?? null
  : null

const isEligibleTributeCard = (hand: Card[], cardId: string): boolean => {
  const card = hand.find(item => item.id === cardId)
  if (!card) return false
  const withoutWildLevel = hand.filter(item => !(item.isLevelCard && item.suit === 'heart'))
  const eligible = withoutWildLevel.length ? withoutWildLevel : hand
  const maximum = Math.max(...eligible.map(item => item.value))
  return eligible.some(item => item.id === cardId) && card.value === maximum
}

const isEligibleReturnCard = (hand: Card[], cardId: string): boolean => {
  const card = hand.find(item => item.id === cardId)
  if (!card) return false
  const lowCards = hand.filter(item => item.value <= 10)
  if (lowCards.length > 0) return card.value <= 10
  const minimum = Math.min(...hand.map(item => item.value))
  return card.value === minimum
}

const matchClockwiseRecipient = (
  state: MatchState,
  from: PlayerId,
  recipients: PlayerId[],
): PlayerId => {
  const start = state.turnOrder.indexOf(from)
  for (let offset = 1; offset <= state.turnOrder.length; offset += 1) {
    const candidate = state.turnOrder[(start + offset) % state.turnOrder.length]
    if (recipients.includes(candidate)) return candidate
  }
  return recipients[0]
}

const resolveRecipients = (
  state: MatchState,
  exchanges: TributeExchange[],
): TributeExchange[] => {
  if (exchanges.length !== 2) return exchanges
  const [third, last] = exchanges
  const thirdCard = selectedCard(state, third.from, third.tributeCardId)
  const lastCard = selectedCard(state, last.from, last.tributeCardId)
  if (!thirdCard || !lastCard) return exchanges
  const recipients = exchanges.map(exchange => exchange.to)
  if (thirdCard.value === lastCard.value) {
    return exchanges.map(exchange => ({
      ...exchange,
      to: matchClockwiseRecipient(state, exchange.from, recipients),
    }))
  }
  const [first, second] = recipients
  const thirdGetsFirst = thirdCard.value > lastCard.value
  return [
    { ...third, to: thirdGetsFirst ? first : second },
    { ...last, to: thirdGetsFirst ? second : first },
  ]
}

const selectTributeCard = (
  state: MatchState,
  command: SelectTributeCardCommand,
): TributeOperationResult => {
  const tribute = state.tribute
  if (!tribute || state.phase !== 'tribute') return failure('MATCH_NOT_IN_TRIBUTE')
  if (tribute.status !== 'selecting_tribute') return failure('TRIBUTE_NOT_SELECTING')
  const exchange = tribute.exchanges.find(candidate => candidate.from === command.playerId)
  if (!exchange) return failure('NOT_TRIBUTE_GIVER')
  if (exchange.tributeCardId) return failure('TRIBUTE_ALREADY_SELECTED')
  if (!isEligibleTributeCard(state.players[command.playerId].hand, command.cardId)) {
    return failure('INELIGIBLE_TRIBUTE_CARD')
  }
  let exchanges = tribute.exchanges.map(candidate => candidate.id === exchange.id
    ? { ...candidate, tributeCardId: command.cardId }
    : candidate)
  const events: GameEvent[] = [{ type: 'TRIBUTE_CARD_SELECTED', playerId: command.playerId }]
  if (!exchanges.every(candidate => candidate.tributeCardId !== null)) {
    return {
      ok: true,
      state: { ...state, tribute: { ...tribute, exchanges } },
      events,
    }
  }

  exchanges = resolveRecipients(state, exchanges)
  const players = cloneMatchPlayers(state)
  for (const candidate of exchanges) {
    const card = selectedCard(state, candidate.from, candidate.tributeCardId)
    if (!card) return failure('TRIBUTE_CARD_NOT_IN_HAND')
    players[candidate.from].hand = players[candidate.from].hand.filter(item => item.id !== card.id)
  }
  for (const candidate of exchanges) {
    const card = selectedCard(state, candidate.from, candidate.tributeCardId)!
    players[candidate.to].hand = [...players[candidate.to].hand, card].sort((a, b) => b.value - a.value)
    events.push({
      type: 'TRIBUTE_TRANSFERRED',
      fromPlayerId: candidate.from,
      toPlayerId: candidate.to,
      cardId: card.id,
    })
  }
  return {
    ok: true,
    state: {
      ...state,
      players,
      tribute: { ...tribute, status: 'selecting_return', exchanges },
    },
    events,
  }
}

const selectReturnCard = (
  state: MatchState,
  command: SelectReturnCardCommand,
): TributeOperationResult => {
  const tribute = state.tribute
  if (!tribute || state.phase !== 'tribute') return failure('MATCH_NOT_IN_TRIBUTE')
  if (tribute.status !== 'selecting_return') return failure('RETURN_NOT_SELECTING')
  const exchange = tribute.exchanges.find(candidate => candidate.to === command.playerId)
  if (!exchange) return failure('NOT_RETURN_GIVER')
  if (exchange.returnCardId) return failure('RETURN_ALREADY_SELECTED')
  if (!isEligibleReturnCard(state.players[command.playerId].hand, command.cardId)) {
    return failure('INELIGIBLE_RETURN_CARD')
  }
  const exchanges = tribute.exchanges.map(candidate => candidate.id === exchange.id
    ? { ...candidate, returnCardId: command.cardId }
    : candidate)
  const events: GameEvent[] = [{ type: 'RETURN_CARD_SELECTED', playerId: command.playerId }]
  if (!exchanges.every(candidate => candidate.returnCardId !== null)) {
    return {
      ok: true,
      state: { ...state, tribute: { ...tribute, exchanges } },
      events,
    }
  }

  const players = cloneMatchPlayers(state)
  for (const candidate of exchanges) {
    const card = selectedCard(state, candidate.to, candidate.returnCardId)
    if (!card) return failure('RETURN_CARD_NOT_IN_HAND')
    players[candidate.to].hand = players[candidate.to].hand.filter(item => item.id !== card.id)
  }
  for (const candidate of exchanges) {
    const card = selectedCard(state, candidate.to, candidate.returnCardId)!
    players[candidate.from].hand = [...players[candidate.from].hand, card].sort((a, b) => b.value - a.value)
    events.push({
      type: 'RETURN_TRANSFERRED',
      fromPlayerId: candidate.to,
      toPlayerId: candidate.from,
      cardId: card.id,
    })
  }
  events.push({ type: 'TRIBUTE_READY', mode: tribute.mode })
  return {
    ok: true,
    state: {
      ...state,
      players,
      tribute: { ...tribute, status: 'ready', exchanges },
    },
    events,
  }
}

const postTributeLeader = (state: MatchState): PlayerId | null => {
  const tribute = state.tribute
  if (!tribute) return null
  if (tribute.status === 'resisted') return state.dealerId
  const first = state.lastRoundRank[0]
  return tribute.exchanges.find(exchange => exchange.to === first)?.from ?? null
}

const beginPlayAfterTribute = (
  state: MatchState,
  command: BeginPlayAfterTributeCommand,
): TributeOperationResult => {
  const tribute = state.tribute
  if (!tribute || state.phase !== 'tribute') return failure('MATCH_NOT_IN_TRIBUTE')
  if (tribute.status !== 'ready' && tribute.status !== 'resisted') return failure('TRIBUTE_NOT_READY')
  const leaderId = postTributeLeader(state)
  if (!leaderId) return failure('TRIBUTE_LEADER_NOT_FOUND')
  if (command.playerId !== leaderId) return failure('NOT_TRIBUTE_LEADER')
  return {
    ok: true,
    state: {
      ...state,
      phase: 'playing',
      currentTurn: leaderId,
      trick: { winningPlay: null, passedPlayerIds: [] },
      lastValidPlay: null,
      tribute: null,
    },
    events: [{
      type: 'PLAY_STARTED_AFTER_TRIBUTE',
      leaderId,
      wasResisted: tribute.status === 'resisted',
    }],
  }
}

export const executeTributeCommand = (
  state: MatchState,
  command: SelectTributeCardCommand | SelectReturnCardCommand | BeginPlayAfterTributeCommand,
): TributeOperationResult => {
  switch (command.type) {
    case 'SELECT_TRIBUTE_CARD': return selectTributeCard(state, command)
    case 'SELECT_RETURN_CARD': return selectReturnCard(state, command)
    case 'BEGIN_PLAY_AFTER_TRIBUTE': return beginPlayAfterTribute(state, command)
  }
}
