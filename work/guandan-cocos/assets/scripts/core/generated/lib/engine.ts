import { createDeck, dealCards, shuffleDeck } from './deck'
import { canPlay, getPlayInfo } from './rules'
import { makeDecision, type Difficulty } from './ai'
import { PlayType } from '../types/game'
import type { Card, PlayAction, Player, PlayerId, Rank, Team } from '../types/game'

export interface EngineState {
  currentLevel: Rank
  players: Record<PlayerId, Player>
  turnOrder: PlayerId[]
  currentTurn: PlayerId
  playArea: PlayAction[]
  lastValidPlay: PlayAction | null
  finishedPlayers: PlayerId[]
}

const ids: PlayerId[] = ['p1', 'p2', 'p3', 'p4']
const teamFor = (id: PlayerId): Team => (id === 'p1' || id === 'p3' ? 'teamA' : 'teamB')
const player = (id: PlayerId, hand: Card[] = []): Player => ({ id, name: id === 'p1' ? '玩家' : `电脑${id.slice(1)}`, isAI: id !== 'p1', team: teamFor(id), hand, role: 'normal' })

export const createGame = (level: Rank = 2, dealer: PlayerId = 'p1'): EngineState => {
  const hands = dealCards(shuffleDeck(createDeck(level)))
  const players = ids.reduce((all, id) => ({ ...all, [id]: player(id, hands[id].sort((a, b) => b.value - a.value)) }), {} as Record<PlayerId, Player>)
  return { currentLevel: level, players, turnOrder: ids, currentTurn: dealer, playArea: [], lastValidPlay: null, finishedPlayers: [] }
}

/** 两个队友包揽前二即双下；否则第三名产生时本局结束。 */
export const isRoundOver = (state: EngineState): boolean => {
  if (state.finishedPlayers.length >= 3) return true
  if (state.finishedPlayers.length < 2) return false
  const [first, second] = state.finishedPlayers
  return state.players[first].team === state.players[second].team
}

/** 补齐尚未出完牌的名次，供结算和下一局进贡使用。 */
export const fullRoundRank = (state: EngineState): PlayerId[] => [
  ...state.finishedPlayers,
  ...ids.filter(id => !state.finishedPlayers.includes(id)),
]

/** 保留座位与队伍配置，为下一局发牌。 */
export const dealNextRound = (previous: EngineState, level: Rank, dealer: PlayerId): EngineState => {
  const hands = dealCards(shuffleDeck(createDeck(level)))
  const players = ids.reduce((all, id) => ({
    ...all,
    [id]: { ...previous.players[id], hand: [...hands[id]].sort((a, b) => b.value - a.value), role: 'normal' as const },
  }), {} as Record<PlayerId, Player>)
  return { currentLevel: level, players, turnOrder: [...previous.turnOrder], currentTurn: dealer, playArea: [], lastValidPlay: null, finishedPlayers: [] }
}

const nextAlive = (state: EngineState, from: PlayerId): PlayerId => {
  let index = state.turnOrder.indexOf(from)
  for (let step = 0; step < 4; step += 1) {
    index = (index + 1) % 4
    const id = state.turnOrder[index]
    if (state.players[id].hand.length > 0) return id
  }
  return from
}

const advance = (state: EngineState): EngineState => {
  if (isRoundOver(state)) return state
  const last = state.lastValidPlay
  if (!last) return { ...state, currentTurn: nextAlive(state, state.currentTurn) }
  const lastIndex = state.playArea.map(action => action === last).lastIndexOf(true)
  const passes = state.playArea.slice(lastIndex + 1).filter(action => action.type === PlayType.Pass).length
  const alive = ids.filter(id => state.players[id].hand.length > 0)
  const required = alive.length - (state.players[last.playerId].hand.length > 0 ? 1 : 0)
  if (passes < required) return { ...state, currentTurn: nextAlive(state, state.currentTurn) }
  const leader = state.players[last.playerId].hand.length > 0 ? last.playerId : state.turnOrder[(state.turnOrder.indexOf(last.playerId) + 2) % 4]
  return { ...state, currentTurn: state.players[leader].hand.length > 0 ? leader : nextAlive(state, state.currentTurn), lastValidPlay: null }
}

export const playCards = (state: EngineState, playerId: PlayerId, cards: Card[]): EngineState => {
  if (state.currentTurn !== playerId) throw new Error('未轮到该玩家出牌')
  if (!getPlayInfo(cards) || !canPlay(cards, state.lastValidPlay)) throw new Error('不合法的出牌')
  const action: PlayAction = { playerId, cards, type: getPlayInfo(cards)!.type }
  const hand = state.players[playerId].hand.filter(card => !cards.some(selected => selected.id === card.id))
  const finishedPlayers = hand.length === 0 && !state.finishedPlayers.includes(playerId) ? [...state.finishedPlayers, playerId] : state.finishedPlayers
  return advance({ ...state, players: { ...state.players, [playerId]: { ...state.players[playerId], hand } }, playArea: [...state.playArea, action], lastValidPlay: action, finishedPlayers })
}

export const passTurn = (state: EngineState, playerId: PlayerId): EngineState => {
  if (state.currentTurn !== playerId || !state.lastValidPlay) throw new Error('当前不能过牌')
  return advance({ ...state, playArea: [...state.playArea, { playerId, cards: [], type: PlayType.Pass }] })
}

export const runAiTurns = (state: EngineState, difficulty: Difficulty = 'medium', maxTurns = 12): EngineState => {
  let next = state
  for (let count = 0; count < maxTurns && next.currentTurn !== 'p1' && !isRoundOver(next); count += 1) {
    const id = next.currentTurn
    const cards = makeDecision(next.players[id].hand, next.lastValidPlay, difficulty, next.players[id].team, next.players, id, { currentLevel: next.currentLevel, teamLevels: { teamA: next.currentLevel, teamB: next.currentLevel }, roundMeta: null })
    next = cards && cards.length > 0 ? playCards(next, id, cards) : passTurn(next, id)
  }
  return next
}
